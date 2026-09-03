//! Running a plugin, and getting an answer out of it.
//!
//! The plugin is a webview at `plugin://<name>/`, served from
//! `~/.planner/plugins/<name>/` by the protocol handler below. Talk goes one
//! way down and one way back up, and the two directions are deliberately
//! different:
//!
//! - **Down**, by `eval`. Injecting a script into a webview is something the
//!   host does to it, so it needs no permission on the plugin's side. The
//!   alternative - emitting an event - would mean granting the plugin window
//!   `core:event`, and `core:event` also carries the power to emit. A plugin
//!   able to emit could announce a fake `vault:changed` at the day page.
//! - **Up**, by the one command `plugin_message`, checked on arrival.
//!
//! Every question has a deadline. A plugin that never answers is a plugin the
//! day page waits for, and the day page waits for nothing.

use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use super::serving::literal;
use super::waiting::{Pending, Started};
use super::{Registry, WINDOW_PREFIX};

/// How long a plugin has to answer before it is assumed broken (spec §7.4).
const DEADLINE: Duration = Duration::from_secs(2);

/// Removes WebRTC from a plugin's webview. Injected into every frame rather
/// than the main one, which is what keeps a same-origin child frame from
/// getting a fresh copy of a constructor the main frame has lost (spec §0.2).
const NO_WEBRTC: &str = include_str!("../../../src/plugins/noWebRTC.js");

/// Starts a plugin: records what it may reach, then builds its webview.
///
/// The window is never shown and has no decorations. It exists to run
/// JavaScript somewhere that is not the app.
pub fn start(
    app: &AppHandle,
    name: &str,
    entry: &str,
    slots: Vec<String>,
    capabilities: Vec<String>,
) -> Result<(), String> {
    let label = format!("{WINDOW_PREFIX}{name}");
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    let registry = app.state::<Registry>();
    registry.grant(name, entry.to_string(), slots, capabilities);

    let url = Url::parse(&format!("plugin://{name}/index.html"))
        .map_err(|error| format!("{name} has a name that cannot be a URL: {error}"))?;

    let refused = name.to_string();
    let handle = app.clone();
    WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(url))
        .visible(false)
        .on_navigation(move |url| {
            if super::navigable(&refused, url) {
                return true;
            }
            eprintln!("planner: {refused} tried to go to {url}");
            // A strike, not an immediate put-away: the handler also fires for
            // a redirect the plugin did not write, and one is a mistake.
            if handle.state::<Registry>().strike(&refused) {
                put_away(&handle, &refused, "kept trying to navigate off its own page");
            }
            false
        })
        .initialization_script_for_all_frames(NO_WEBRTC)
        .build()
        .map_err(|error| format!("could not start {name}: {error}"))?;

    eprintln!("planner: plugin {name} started");
    Ok(())
}

/// Puts a plugin away for the session, and takes its webview with it.
///
/// Marking the record is not enough. A plugin put away for hanging is a
/// plugin still running - a pathological regular expression would spin a
/// hidden webview until the app was quit - so the window goes as well.
pub fn put_away(app: &AppHandle, name: &str, reason: &str) {
    app.state::<Registry>().disable(name, reason);
    eprintln!("planner: {name} has been put away for this session: {reason}");
    close(app, name);
}

/// Closes a plugin's webview, from wherever this was called.
///
/// Posted to the event loop rather than run here, and deliberately from
/// another thread: `run_on_main_thread` runs its closure *inline* when it is
/// already on the main thread, and one of this function's callers is a
/// navigation delegate that has not yet answered its own decision handler.
/// Closing the window underneath it would be re-entrant. The async runtime is
/// a different thread, so the message takes the event loop's queue instead.
fn close(app: &AppHandle, name: &str) {
    let label = format!("{WINDOW_PREFIX}{name}");
    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        let inner = handle.clone();
        let asked = handle.run_on_main_thread(move || {
            // Already gone is the ordinary case: a plugin can be put away
            // twice, and the second time there is nothing left to close.
            let Some(window) = inner.get_webview_window(&label) else { return };
            if let Err(error) = window.close() {
                eprintln!("planner: could not close {label}: {error}");
            }
        });
        if let Err(error) = asked {
            eprintln!("planner: could not ask the event loop to close a plugin: {error}");
        }
    });
}

/// Asks a plugin something and waits for the answer, or the deadline.
///
/// Blocking, and called from a blocking task - never from the thread drawing
/// the page.
pub fn ask(app: &AppHandle, name: &str, request: &Value) -> Result<Value, String> {
    let label = format!("{WINDOW_PREFIX}{name}");
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("{name} is not running"))?;

    // One deadline for the whole exchange, not one per leg: what the page
    // cannot afford is the total wait.
    let deadline = Instant::now() + DEADLINE;
    if !app.state::<Started>().wait(name, deadline) {
        put_away(app, name, "did not finish starting");
        return Err(format!("{name} did not finish starting"));
    }

    let (id, answer) = app.state::<Pending>().ask_of(name);

    let mut envelope = request.clone();
    envelope["id"] = Value::from(id);
    let script = format!("window.__planner.request({})", literal(&envelope));

    if let Err(error) = window.eval(&script) {
        app.state::<Pending>().forget(id);
        return Err(format!("could not reach {name}: {error}"));
    }

    let left = deadline.saturating_duration_since(Instant::now());
    match answer.recv_timeout(left) {
        Ok(result) => result,
        Err(RecvTimeoutError::Timeout) => {
            app.state::<Pending>().forget(id);
            // A plugin that misses its deadline is not asked again this
            // session: the next page turn would wait the same two seconds.
            put_away(app, name, &format!("did not answer within {}s", DEADLINE.as_secs()));
            Err(format!("{name} did not answer within {}s", DEADLINE.as_secs()))
        }
        // The sender was dropped rather than the deadline missed. Nobody has
        // done that yet; a restart will (spec §1.2), and putting a healthy
        // plugin away for having been restarted would make the first thing
        // phase one builds unusable.
        Err(RecvTimeoutError::Disconnected) => {
            app.state::<Pending>().forget(id);
            Err(format!("{name} was interrupted before it answered"))
        }
    }
}
