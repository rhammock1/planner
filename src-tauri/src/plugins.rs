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

pub mod host;
pub mod waiting;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
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

/// What each running plugin was granted, and whether it is still trusted.
#[derive(Default)]
pub struct Registry(Mutex<HashMap<String, Grant>>);

struct Grant {
    /// The file the plugin starts at, from its manifest.
    entry: String,
    /// The intersection of what the manifest asked for and what the config
    /// granted, worked out in the frontend where the one TOML reader lives.
    capabilities: Vec<String>,
    /// Requests for something never granted. A plugin asking once may have a
    /// stale manifest; asking repeatedly is not a misunderstanding.
    strikes: u32,
    disabled: bool,
}

/// How many ungranted requests a plugin gets before it is put away.
const STRIKES: u32 = 3;

impl Registry {
    /// Records what a plugin may reach. Called by the app's own window, which
    /// read the manifest and the config; never by a plugin, which cannot
    /// reach this command at all.
    pub fn grant(&self, name: &str, entry: String, capabilities: Vec<String>) {
        let mut held = self.0.lock().expect("registry lock");
        held.insert(
            name.to_string(),
            Grant { entry, capabilities, strikes: 0, disabled: false },
        );
    }

    pub fn entry_of(&self, name: &str) -> Option<String> {
        let held = self.0.lock().expect("registry lock");
        held.get(name).map(|grant| grant.entry.clone())
    }

    /// The plugins worth asking anything of: started, and not put away.
    pub fn running(&self) -> Vec<String> {
        let held = self.0.lock().expect("registry lock");
        let mut names: Vec<String> = held
            .iter()
            .filter(|(_, grant)| !grant.disabled)
            .map(|(name, _)| name.clone())
            .collect();
        // Stable order, so two runs contribute the same list in the same
        // order and the section does not shuffle between launches.
        names.sort();
        names
    }

    /// Whether a plugin may use a capability right now.
    pub fn permits(&self, name: &str, capability: &str) -> bool {
        let held = self.0.lock().expect("registry lock");
        held.get(name).is_some_and(|grant| {
            !grant.disabled && grant.capabilities.iter().any(|held| held == capability)
        })
    }

    /// Records a request for something the plugin was not granted, and says
    /// whether that was one too many.
    pub fn strike(&self, name: &str) -> bool {
        let mut held = self.0.lock().expect("registry lock");
        let Some(grant) = held.get_mut(name) else { return false };
        grant.strikes += 1;
        if grant.strikes >= STRIKES {
            grant.disabled = true;
        }
        grant.disabled
    }

    /// Puts a plugin away for the session - it threw, hung, or overran.
    pub fn disable(&self, name: &str) {
        let mut held = self.0.lock().expect("registry lock");
        if let Some(grant) = held.get_mut(name) {
            grant.disabled = true;
        }
    }

    pub fn disabled(&self, name: &str) -> bool {
        let held = self.0.lock().expect("registry lock");
        held.get(name).map(|grant| grant.disabled).unwrap_or(true)
    }
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
    let Some(root) = crate::planner_dir().map(|dir| dir.join("plugins")) else {
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

/// What a plugin sends up through the one door.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Message {
    /// Asking the app for something. Checked against the manifest below.
    Capability { capability: String, method: String, params: Value },
    /// Answering a question the app asked.
    Reply { id: u64, value: Value },
    /// Failing to answer one. A plugin that says so is better behaved than
    /// one that goes quiet, and is not struck for it.
    Failed { id: u64, error: String },
    /// The plugin's own code has run. Nothing is asked of it before this.
    Ready,
}

/// The door (spec §7.1). Every message a plugin sends arrives here.
#[tauri::command]
pub fn plugin_message(
    app: AppHandle,
    webview: tauri::Webview,
    message: Message,
) -> Result<Value, String> {
    // The window's label, not anything the message claims to be. A plugin
    // cannot name itself something else: the label was set when the app built
    // the window, and nothing inside it can change it.
    let name = plugin_of(webview.label())
        .ok_or("only a plugin may send this")?
        .to_string();

    match message {
        Message::Ready => {
            app.state::<waiting::Started>().mark(&name);
            Ok(Value::Null)
        }
        Message::Reply { id, value } => answer(&app, &name, id, Ok(value)),
        Message::Failed { id, error } => {
            eprintln!("planner: {name} could not answer: {error}");
            answer(&app, &name, id, Err(error))
        }
        Message::Capability { capability, method, params } => {
            let registry = app.state::<Registry>();
            if !registry.permits(&name, &capability) {
                eprintln!("planner: {name} asked for {capability}, which it was not granted");
                if registry.strike(&name) {
                    eprintln!("planner: {name} has been put away for this session");
                }
                return Err(format!("{name} was not granted {capability}"));
            }
            crate::bridges::dispatch(&capability, &method, &params)
        }
    }
}

/// Passes an answer back, if it was this plugin's to give.
///
/// A plugin answering a question put to another is not a mistake it could
/// make by accident - the id was never sent to it - so it counts as a strike.
fn answer(app: &AppHandle, name: &str, id: u64, result: Result<Value, String>) -> Result<Value, String> {
    let registry = app.state::<Registry>();
    match app.state::<waiting::Pending>().settle(name, id, result) {
        Ok(()) => Ok(Value::Null),
        Err(refusal) => {
            eprintln!("planner: {refusal}");
            if registry.strike(name) {
                eprintln!("planner: {name} has been put away for this session");
            }
            Err(refusal)
        }
    }
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
