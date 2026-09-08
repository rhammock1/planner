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

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use super::serving::literal;
use super::waiting::{envelope, Pending, Started};
use super::{Registry, WINDOW_PREFIX};

/// How long a plugin has to answer before it is assumed broken (spec §7.4).
const DEADLINE: Duration = Duration::from_secs(2);

/// How long a webview gets to go away before the app stops waiting for it.
const CLOSING: Duration = Duration::from_secs(2);

/// Removes WebRTC from a plugin's webview. Injected into every frame rather
/// than the main one, which is what keeps a same-origin child frame from
/// getting a fresh copy of a constructor the main frame has lost (spec §0.2).
const NO_WEBRTC: &str = include_str!("../../../src/plugins/noWebRTC.js");

/// Starts a plugin: records what it may reach, then builds its webview.
///
/// The window is never shown and has no decorations. It exists to run
/// JavaScript somewhere that is not the app.
pub fn start(app: &AppHandle, granting: super::registry::Granting) -> Result<(), String> {
    // Only the name is wanted here. The entry file and the settings are read
    // back out of the registry by `serving.rs` when the page is built, which
    // is why they are not unpacked: this function starts a window, and what
    // that window is served is the grant's business.
    let name = granting.name.clone();
    let name = name.as_str();
    let label = format!("{WINDOW_PREFIX}{name}");
    if app.get_webview_window(&label).is_some() {
        // Loud rather than silent. A start that quietly does nothing is a
        // plugin running the old code with the new config, and the only
        // symptom is a setting that appears not to have taken (spec §1.2).
        return Err(format!("{name} is already running"));
    }

    let registry = app.state::<Registry>();
    registry.grant(granting);

    let url = Url::parse(&format!("plugin://{name}/index.html"))
        .map_err(|error| format!("{name} has a name that cannot be a URL: {error}"))?;

    let refused = name.to_string();
    let handle = app.clone();
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(url))
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
        .build();

    // The grant goes in before the build because the protocol handler reads
    // it while the webview loads `plugin://<name>/index.html` - `entry_of`
    // and `settings_of` are what the served page is written from. So a
    // window that would not build has to have the grant taken back here:
    // left standing, `may_open` and `running_for` both key off
    // `running && !disabled` and would go on answering for a window that
    // never existed.
    if let Err(error) = built {
        registry.stop(name);
        return Err(format!("could not start {name}: {error}"));
    }

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

/// Stops a plugin: settles what it was holding, forgets it, and closes its
/// webview - and does not return until the webview is gone.
///
/// The waiting is the point. Tauri's `close()` posts to the event loop and the
/// label leaves the window map only when `Destroyed` is processed, so a
/// stop-then-start that did not wait would find the old label still there and
/// `start` would refuse it (spec §1.2). A listener registered here sees
/// `Destroyed` *after* the manager has removed the label: the runtime hands
/// the event to Tauri's own callback before it runs the window's listeners
/// (tauri-runtime-wry `src/lib.rs`, the `Event::WindowEvent` branch), and that
/// callback is what removes it.
pub fn stop(app: &AppHandle, name: &str) -> Result<(), String> {
    // Off the list first, so nothing new is asked of it while it is going.
    app.state::<Registry>().stop(name);
    app.state::<Pending>().settle_all_of(name, &format!("{name} is restarting"));
    app.state::<Started>().forget(name);

    let label = format!("{WINDOW_PREFIX}{name}");
    let Some(window) = app.get_webview_window(&label) else {
        // Already gone is the ordinary case: a plugin put away for hanging
        // has had its webview closed already.
        return Ok(());
    };

    let (gone, went) = std::sync::mpsc::channel();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = gone.send(());
        }
    });

    close(app, name);

    match went.recv_timeout(CLOSING) {
        Ok(()) => Ok(()),
        // Said out loud and returned as an error rather than swallowed: the
        // caller is about to start a plugin under this label, and it will not
        // go. A silent skip here is spec §1.2's "loud rather than silent".
        Err(error) => {
            eprintln!("planner: {label} did not close: {error}");
            Err(format!("{name} would not close"))
        }
    }
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
pub fn ask(app: &AppHandle, name: &str, slot: &str, now: &Value, params: &Value) -> Result<Value, String> {
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
    let script = format!("window.__planner.request({})", literal(&envelope(id, slot, now, params)));

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

/// What every plugin had to say, keyed by which one said it.
///
/// Keyed, not merged: the key is what lets the page put a heading over each
/// plugin's lines, group results by provider, and refuse a claim two plugins
/// both made (spec §1.3).
#[derive(Default, Serialize)]
pub struct Answers {
    answers: Vec<Answer>,
    /// One line each, for the day page's notice band.
    notices: Vec<String>,
}

#[derive(Serialize)]
struct Answer {
    plugin: String,
    /// Whatever the plugin returned, unexamined. The frontend checks the
    /// shape of it before it reaches a page - this is not our data.
    value: Value,
}

/// Asks every plugin granted this slot, all at once.
///
/// Concurrent, and that is the point: one deadline for the whole round rather
/// than one per plugin. Every task is spawned before any is awaited, so a
/// plugin that takes the full two seconds does not add two seconds to the one
/// after it.
pub async fn ask_all(app: &AppHandle, slot: &str, now: &Value, params: &Value) -> Answers {
    let mut flying = Vec::new();
    for name in app.state::<Registry>().running_for(slot) {
        let handle = app.clone();
        let asked = name.clone();
        let now = now.clone();
        let params = params.clone();
        let slot = slot.to_string();
        flying.push((
            name,
            tauri::async_runtime::spawn_blocking(move || {
                ask(&handle, &asked, &slot, &now, &params)
            }),
        ));
    }

    let mut gathered = Answers::default();
    for (name, task) in flying {
        match task.await {
            Ok(Ok(value)) => gathered.answers.push(Answer { plugin: name, value }),
            Ok(Err(error)) => gathered.notices.push(error),
            // The blocking pool itself failed, which is not the plugin's
            // fault and is worth a different sentence.
            Err(error) => gathered.notices.push(format!("could not ask {name}: {error}")),
        }
    }
    gathered
}
