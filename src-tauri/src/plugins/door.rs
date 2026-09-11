//! The door (spec §7.1). Every message a plugin sends arrives here.
//!
//! One command, checked on arrival. What a plugin may then ask for is a
//! second question, answered by `Registry` against the capabilities the
//! config granted it.

use std::collections::HashMap;
use std::sync::Mutex;

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

/// How many capability calls one plugin may have in the air at once.
///
/// One per slot this app offers, because that is exactly how many questions
/// the app can have outstanding at one plugin: `ask_all` spawns a round per
/// slot, and a single draw of the day page puts `vault.contribute` and
/// `page.note` to the same plugin in the same tick. A plugin that answers
/// both out of one capability - `macos-calendar` reads the calendar for each
/// - is not being impatient; it is answering the two questions it was just
/// asked, and refusing the second is the app tripping over its own feet.
///
/// This was 1, and the cost was a day's meetings quietly offering no notes:
/// `page.note` lost the race to `vault.contribute`, the plugin caught the
/// refusal the way it is meant to, and a day with events on it drew no offer
/// and said nothing about why.
const MOST_AT_ONCE: usize = 6;

/// The capability calls each plugin has in flight.
///
/// `spawn_blocking` runs on a pool the whole app shares, and it is not a
/// plugin's to fill: ten calls at once from one plugin would hold ten threads
/// while the app's own work queued behind them. Capped rather than uncapped,
/// at the number of questions this app can actually be waiting on.
#[derive(Default)]
pub struct InFlight(Mutex<HashMap<String, usize>>);

impl InFlight {
    /// Takes one of the plugin's places, or says they are all taken.
    pub fn enter(&self, name: &str) -> bool {
        let mut held = self.0.lock().expect("in-flight lock");
        let count = held.entry(name.to_string()).or_insert(0);
        if *count >= MOST_AT_ONCE {
            return false;
        }
        *count += 1;
        true
    }

    /// Gives one back. Called on every way out of a call, including the ones
    /// that failed - and harmless when nothing was taken, which is what an
    /// error branch on the way out does.
    pub fn leave(&self, name: &str) {
        let mut held = self.0.lock().expect("in-flight lock");
        let Some(count) = held.get_mut(name) else { return };
        *count -= 1;
        if *count == 0 {
            held.remove(name);
        }
    }

    /// Takes one of the plugin's places and hands back something that gives
    /// it up.
    pub fn hold(&self, name: &str) -> Option<Flying<'_>> {
        self.enter(name).then(|| Flying { flight: self, name: name.to_string() })
    }
}

/// Holds a plugin's one slot for as long as this is alive.
///
/// A guard rather than a line after the call, because the line does not run
/// when the future around it is dropped, and the plugin would be locked out
/// of every capability for the rest of the session with nothing said.
pub struct Flying<'a> {
    flight: &'a InFlight,
    name: String,
}

impl Drop for Flying<'_> {
    fn drop(&mut self) {
        self.flight.leave(&self.name);
    }
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
    /// The plugin's own code has run, and these are the slots it registered a
    /// handler for. Nothing is asked of it before this.
    Ready { #[serde(default)] slots: Vec<String> },
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
        Message::Ready { slots } => {
            app.state::<Registry>().registered(&name, slots);
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
            // Declared and not ticked is a decision nobody has made yet, and
            // charging a strike for it bricks a correctly-written plugin on
            // the day it is installed - which is the one day it is certain to
            // hit this. `docs/plugins.md` promises as much. Only a capability
            // the plugin's own manifest never declared is a strike (spec §1.2).
            if registry.declared_capability(name, &capability) {
                return Err(format!(
                    "{name} was not granted {capability}; it has not been ticked in settings"
                ));
            }
            eprintln!("planner: {name} asked for {capability}, which its manifest never declared");
            if registry.strike(name) {
                super::host::put_away(app, name, "asked three times for something it never declared");
            }
            return Err(format!("{name} was not granted {capability}"));
        }
    }

    // Refused rather than queued, and never a strike: a plugin past its
    // allowance is impatient, not dishonest, and a queued call would hold a
    // thread waiting for the ones in front of it (spec §0.2, §6). The
    // allowance is one per slot, so a plugin can always answer everything the
    // app asked it at once and never more - see `MOST_AT_ONCE`.
    //
    // `inner()` rather than the `State` itself, because the guard has to
    // outlive the temporary and `State::inner` hands back a borrow with the
    // app handle's own lifetime. `_flying` gives the slot back when this
    // function returns, however it returns.
    let flight = app.state::<InFlight>();
    let Some(_flying) = flight.inner().hold(name) else {
        return Err(format!("{name} has too many capability calls in the air at once"));
    };

    // Cloned into the blocking task: everything alive across an await point
    // has to be owned by the future, and neither a `State` nor a borrow of the
    // caller's name can be.
    let handle = app.clone();
    let caller = name.to_string();
    let done = tauri::async_runtime::spawn_blocking(move || {
        crate::bridges::dispatch(&handle, &caller, &capability, &method, &params)
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
