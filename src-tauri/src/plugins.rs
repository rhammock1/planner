//! The plugin sandbox (spec §7, and the addendum of 2026-09-01).
//!
//! A plugin is somebody else's code running inside this app, so the question
//! this module answers is not "what can it do" but "what is stopping it".
//! Three things are:
//!
//! 1. Its own origin. It runs in a hidden webview at `plugin://<name>/`, so
//!    it cannot reach the app's DOM, its storage, or its windows.
//! 2. No core permissions. The plugin window is absent from
//!    `capabilities/default.json`, so it cannot listen for `vault:changed` -
//!    or, more to the point, emit a fake one at the day page. Messages to a
//!    plugin are injected host-side instead, which needs no permission at all.
//! 3. This file. Tauri's ACL governs core and plugin commands, but an app's
//!    own commands are not gated by it: without the check below, a plugin
//!    webview could call `write_page` directly. So every invoke passes
//!    through `allowed`, and from a plugin window exactly one command does.
//!
//! What a plugin may then ask for is a second question, answered by
//! `Registry` against the capabilities the config granted it.

pub mod door;
pub mod host;
pub mod registry;
pub mod waiting;

pub use door::Message;
pub use registry::{Registry, STRIKES};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// The prefix a plugin window's label carries. Nothing else may use it: the
/// label is what the gate below reads, so a window that borrows the prefix
/// borrows the restrictions with it.
pub const WINDOW_PREFIX: &str = "plugin-";

/// The one command a plugin may call. Everything a plugin can ask of the app
/// arrives through here and is checked against its manifest.
pub const DOOR: &str = "plugin_message";

/// The plugin a window label names, or `None` for one of the app's own.
pub fn plugin_of(label: &str) -> Option<&str> {
    label.strip_prefix(WINDOW_PREFIX).filter(|name| !name.is_empty())
}

/// Whether a window may call a command.
///
/// The app's own windows may call anything - they are this app. A plugin
/// window may call the door and nothing else, including commands added years
/// from now by someone who never read this file. That is the point of
/// answering the question here rather than inside each command.
pub fn allowed(label: &str, command: &str) -> bool {
    plugin_of(label).is_none() || command == DOOR
}

/// A plugin folder as found on disk, for the frontend to make sense of.
///
/// The manifest is handed over as text: there is one TOML reader in this
/// project and it is in JavaScript, the same rule `config.toml` follows.
#[derive(Serialize)]
pub struct Folder {
    name: String,
    manifest: String,
}

/// Everything installed, whether or not the config enables it.
#[tauri::command]
pub fn list_plugins() -> Vec<Folder> {
    let Some(root) = crate::settings::planner_dir().map(|dir| dir.join("plugins")) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&root) else { return Vec::new() };

    let mut found: Vec<Folder> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let manifest = std::fs::read_to_string(entry.path().join("manifest.toml")).ok()?;
            Some(Folder { name, manifest })
        })
        .collect();
    found.sort_by(|left, right| left.name.cmp(&right.name));
    found
}

/// Starts a plugin with the capabilities the frontend worked out.
///
/// Only the app's own windows can reach this: a plugin window is held to
/// `plugin_message` by the gate, so no plugin can grant itself anything.
#[tauri::command]
pub fn start_plugin(
    app: AppHandle,
    name: String,
    entry: String,
    capabilities: Vec<String>,
) -> Result<(), String> {
    host::start(&app, &name, &entry, capabilities)
}

/// What the plugins have to add to a range of days, and anything that went
/// wrong finding out.
#[derive(Default, Serialize)]
pub struct Contributions {
    /// Whatever the plugins returned, unexamined. The frontend checks the
    /// shape of each one before it reaches a page - this is not our data.
    items: Vec<Value>,
    /// One line each, for the day page's notice band. A plugin that fails
    /// says so on screen rather than only in a log nobody is reading (§8).
    notices: Vec<String>,
}

/// Asks every running plugin what it has for these days.
///
/// Blocking work, kept off the thread that draws: the page renders without
/// contributions and gets them when they arrive, or does not get them.
#[tauri::command]
pub async fn contribute(app: AppHandle, from: String, to: String) -> Contributions {
    let task = tauri::async_runtime::spawn_blocking(move || {
        let request = json!({ "kind": "contribute", "from": from, "to": to });
        let mut gathered = Contributions::default();

        for name in app.state::<Registry>().running() {
            match host::ask(&app, &name, &request) {
                Ok(Value::Array(items)) => gathered.items.extend(items),
                Ok(_) => gathered
                    .notices
                    .push(format!("{name} returned something that is not a list")),
                Err(error) => gathered.notices.push(error),
            }
        }
        gathered
    });

    match task.await {
        Ok(gathered) => gathered,
        Err(error) => Contributions {
            items: Vec::new(),
            notices: vec![format!("could not ask the plugins: {error}")],
        },
    }
}
