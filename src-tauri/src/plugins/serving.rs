//! Serving a plugin's own files at `plugin://<name>/`.
//!
//! A plugin gets its own origin and its own folder, and nothing else on the
//! disk. The index is written here rather than read from the folder: it is
//! what installs the runtime before the plugin's own code gets to run, and a
//! plugin shipping its own `index.html` must not be able to skip it.
//!
//! Separate from `host.rs` because running a plugin's window and answering
//! its requests for files are two jobs, and only one of them has anything to
//! do with deadlines.

use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager};

use super::Registry;

/// The shim that gives a plugin its `planner` object. Baked into the binary
/// rather than read from the plugin folder, so a plugin cannot replace the
/// thing that stands between it and the app.
const RUNTIME: &str = include_str!("../../../src/plugins/runtime.js");

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
pub(super) fn literal(value: &Value) -> String {
    value
        .to_string()
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// A JSON value as a JavaScript expression that is safe *inside a script
/// element*.
///
/// `literal` is right for `eval`, where the two line separators are the only
/// characters JSON has and JavaScript does not. Inside HTML there is a third
/// problem: the parser looks for `</script` in the text, so a setting
/// containing one would end the page before `ready()` ran - and a plugin that
/// never says ready is a plugin that hangs until its deadline every time it is
/// asked anything.
///
/// `<`, `>` and `&` all become escapes rather than only the sequence that
/// matters, because "only the sequence that matters" is the sentence at the
/// front of every one of these bugs.
pub fn in_html(value: &Value) -> String {
    literal(value)
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
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
        let registry = app.state::<Registry>();
        let entry = registry.entry_of(name).unwrap_or_default();
        let settings = registry.settings_of(name);
        // The entry is imported rather than loaded with `src`, so the ready
        // signal is a statement after it in the same module: module bodies
        // run in document order, and an import finishes before the line
        // below it. A second `<script>` would not do - a classic script
        // after a module runs before it, and would say ready too early.
        //
        // The settings go in their own classic script *before* the runtime's,
        // so `planner.settings` is already there when the plugin's own code
        // runs. Frozen, so a plugin cannot convince itself it changed one.
        let page = format!(
            "<!doctype html><meta charset=\"utf-8\">\n\
             <script>{RUNTIME}</script>\n\
             <script>window.__planner.settings = Object.freeze({})</script>\n\
             <script type=\"module\">import {}; window.__planner.ready()</script>\n",
            in_html(&settings),
            in_html(&Value::from(format!("./{entry}")))
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
