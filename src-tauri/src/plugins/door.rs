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

/// The most a plugin may send up in one message.
///
/// Both directions of a plugin's own talk arrive here - a capability's params
/// and a reply's value - so one cap covers both. A megabyte is far more than
/// any answer this API asks for and small enough that a plugin cannot fill
/// memory by answering (spec §0.2).
pub const LIMIT: usize = 1024 * 1024;

/// Whether a message is more than the door will carry.
///
/// This is a cap on what a plugin may *say*, not on what it may allocate: by
/// the time it is asked, Tauri has already parsed the payload into the value
/// being measured. Bounding the allocation would mean reading the IPC body
/// before it is deserialised, which this app has no seam for. What the cap
/// buys is that nothing enormous is carried on past this line - into a
/// capability's params, into a reply the page will read, into a log.
pub fn too_large(message: &Value) -> bool {
    serde_json::to_vec(message)
        .map(|bytes| bytes.len())
        // A value that will not serialise is not a value this app can size,
        // and refusing it is the safe way round.
        .unwrap_or(usize::MAX)
        > LIMIT
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
///
/// `async`, and that is the point of it. A plain Tauri command runs inline on
/// the thread the IPC arrived on - on macOS, the main thread - so the
/// calendar bridge froze the app for as long as EventKit took, and
/// `shell.run` would freeze it for five seconds (spec §0.2). An async command
/// runs on the async runtime, and the blocking work under it is handed to
/// `spawn_blocking` besides.
///
/// The message arrives as raw JSON rather than a `Message`, because the cap
/// below has to be applied to what was sent rather than to what it parsed to.
#[tauri::command]
pub async fn plugin_message(
    app: AppHandle,
    webview: tauri::Webview,
    message: Value,
) -> Result<Value, String> {
    // The window's label, not anything the message claims to be. A plugin
    // cannot name itself something else: the label was set when the app built
    // the window, and nothing inside it can change it.
    let name = plugin_of(webview.label())
        .ok_or("only a plugin may send this")?
        .to_string();

    if too_large(&message) {
        // A strike. The runtime this app injects never sends anything of this
        // size, so a message that is one came from code that replaced it.
        if app.state::<Registry>().strike(&name) {
            super::host::put_away(&app, &name, "sent more than the door carries");
        }
        return Err(format!("{name} sent more than the door carries"));
    }

    // Not a strike. A plugin may rewrite the runtime in its own webview, so
    // nonsense here is as likely to be a bug in somebody's build step as an
    // attempt at anything, and it reaches nothing either way.
    let message: Message = serde_json::from_value(message)
        .map_err(|error| format!("{name} sent something the door does not understand: {error}"))?;

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
            run_capability(&app, &name, capability, method, params).await
        }
    }
}

/// A granted capability, run off the door's thread.
///
/// The bridge underneath is EventKit today and a child process in phase two.
/// Both block, and neither may block the runtime the door is on.
async fn run_capability(
    app: &AppHandle,
    name: &str,
    capability: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    // Scoped, because a `State` borrows the app handle and everything alive
    // at an await point has to be carried by the future. Nothing here needs
    // to outlive the check.
    {
        let registry = app.state::<Registry>();
        if !registry.permits(name, &capability) {
            eprintln!("planner: {name} asked for {capability}, which it was not granted");
            if registry.strike(name) {
                super::host::put_away(app, name, "asked three times for something it was not granted");
            }
            return Err(format!("{name} was not granted {capability}"));
        }
    }

    let done = tauri::async_runtime::spawn_blocking(move || {
        crate::bridges::dispatch(&capability, &method, &params)
    })
    .await;

    match done {
        Ok(result) => result,
        Err(error) => Err(format!("{name}'s call did not finish: {error}")),
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
                super::host::put_away(app, name, "answered a question put to another plugin");
            }
            Err(refusal)
        }
    }
}
