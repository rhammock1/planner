//! The door (spec §7.1). Every message a plugin sends arrives here.
//!
//! One command, checked on arrival. What a plugin may then ask for is a
//! second question, answered by `Registry` against the capabilities the
//! config granted it.

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::waiting::{Pending, Started};
use super::{plugin_of, Registry};

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
            app.state::<Started>().mark(&name);
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
    match app.state::<Pending>().settle(name, id, result) {
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
