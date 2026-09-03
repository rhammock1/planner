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

use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use super::waiting::{Pending, Started};
use super::{Registry, WINDOW_PREFIX};

/// How long a plugin has to answer before it is assumed broken (spec §7.4).
const DEADLINE: Duration = Duration::from_secs(2);

/// The shim that gives a plugin its `planner` object. Baked into the binary
/// rather than read from the plugin folder, so a plugin cannot replace the
/// thing that stands between it and the app.
const RUNTIME: &str = include_str!("../../../src/plugins/runtime.js");

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

/// The file a plugin asked for, so long as it is inside the plugin's folder.
///
/// The check is on the resolved path rather than the text, so `.`, a doubled
/// separator, an encoding trick and a symlink pointing at `~/.ssh` are all
/// the same question and get the same answer. A plugin gets its own folder
/// and nothing else on the disk.
pub fn within(root: &Path, path: &str) -> Result<PathBuf, String> {
    let real_root = root.canonicalize().map_err(|error| error.to_string())?;
    let wanted = real_root.join(path).canonicalize().map_err(|error| error.to_string())?;
    if !wanted.starts_with(&real_root) {
        return Err(format!("{path} is outside the plugin's folder"));
    }
    Ok(wanted)
}

/// A JSON value as a JavaScript expression.
///
/// JSON is very nearly a subset of JavaScript. The two characters where it is
/// not are line separators, legal inside a JSON string and not inside a
/// JavaScript one, and a plugin name or an event title may contain either.
fn literal(value: &Value) -> String {
    value
        .to_string()
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// Answers a `plugin://` request.
///
/// The policy on every response is what keeps a plugin on this machine: it
/// may load its own files and nothing else, and `connect-src 'none'` closes
/// `fetch`, `XMLHttpRequest` and websockets outright. Whatever a plugin needs
/// from outside it asks for as a capability, where the manifest can be
/// consulted (spec §7.3). The one channel this leaves open is the IPC bridge,
/// which is not a network request and is answered by the gate instead.
/// `form-action 'none'` is the other half of the navigation handler: a form
/// post is a navigation the handler would refuse, and refusing it twice costs
/// nothing. `base-uri 'none'` stops a `<base>` element moving what "its own
/// folder" means. `frame-ancestors 'none'` guards nothing today - there is no
/// frame - and is here so that the day one appears, it is refused by default.
const POLICY: &str = "default-src 'self'; \
                      script-src 'self' 'unsafe-inline'; \
                      connect-src 'none'; \
                      img-src 'none'; \
                      style-src 'unsafe-inline'; \
                      form-action 'none'; \
                      base-uri 'none'; \
                      frame-ancestors 'none'";

/// A plugin's own file, or nothing at all.
pub fn respond(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let name = request.uri().host().unwrap_or_default();
    let path = request.uri().path().trim_start_matches('/');

    let built = match serve(app, name, path) {
        Ok((body, mime)) => Response::builder()
            .header("Content-Type", mime)
            .header("Content-Security-Policy", POLICY)
            .body(body),
        Err(error) => {
            // Said out loud: a plugin whose page is silently empty is a bug
            // report that starts "it just doesn't do anything".
            eprintln!("planner: plugin://{name}/{path}: {error}");
            Response::builder().status(404).body(Vec::new())
        }
    };

    // A response that will not build is a header this file got wrong, not
    // anything the plugin did. It still has to be an answer.
    built.unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Serves `plugin://<name>/<path>` out of `~/.planner/plugins/<name>/`.
///
/// The index is written here rather than read from the folder: it is what
/// installs the runtime before the plugin's own code gets to run, and a plugin
/// shipping its own `index.html` must not be able to skip it.
fn serve(app: &AppHandle, name: &str, path: &str) -> Result<(Vec<u8>, &'static str), String> {
    if path.is_empty() || path == "index.html" {
        let entry = app.state::<Registry>().entry_of(name).unwrap_or_default();
        // The entry is imported rather than loaded with `src`, so the ready
        // signal is a statement after it in the same module: module bodies
        // run in document order, and an import finishes before the line
        // below it. A second `<script>` would not do - a classic script
        // after a module runs before it, and would say ready too early.
        let page = format!(
            "<!doctype html><meta charset=\"utf-8\">\n\
             <script>{RUNTIME}</script>\n\
             <script type=\"module\">import {}; window.__planner.ready()</script>\n",
            literal(&Value::from(format!("./{entry}")))
        );
        return Ok((page.into_bytes(), "text/html"));
    }

    let root = crate::settings::planner_dir()
        .map(|dir| dir.join("plugins").join(name))
        .ok_or("no plugin folder")?;
    let resolved = within(&root, path)?;

    let body = std::fs::read(&resolved).map_err(|error| error.to_string())?;
    let mime = match resolved.extension().and_then(|part| part.to_str()) {
        Some("js") | Some("mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        _ => "text/plain",
    };
    Ok((body, mime))
}
