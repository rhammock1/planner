//! Waiting on a plugin: what has been asked, and what is ready to be asked.
//!
//! Both types exist for the same reason. A plugin answers when it answers -
//! it is a webview running somebody else's code - and the page it is
//! answering for has already been drawn. So nothing here blocks anything
//! except the one blocking task that chose to wait, and everything has a
//! deadline.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Condvar, Mutex};
use std::time::Instant;

use serde_json::Value;

/// Questions asked and not yet answered, each remembering who was asked.
///
/// The owner is not bookkeeping. Ids are numbers handed out in order, so a
/// second plugin could otherwise guess one and answer a question put to the
/// first - and the answer would arrive as if the right plugin had given it.
/// A plugin may only answer what was asked of it.
#[derive(Default)]
pub struct Pending {
    next: AtomicU64,
    waiting: Mutex<HashMap<u64, (String, Sender<Result<Value, String>>)>>,
}

impl Pending {
    /// Opens a question addressed to one plugin.
    pub fn ask_of(&self, owner: &str) -> (u64, Receiver<Result<Value, String>>) {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = channel();
        self.waiting
            .lock()
            .expect("pending lock")
            .insert(id, (owner.to_string(), sender));
        (id, receiver)
    }

    /// Hands an answer to whoever is waiting for it.
    ///
    /// `Ok(())` covers the answer that arrives too late as well as the one
    /// that arrives in time: the deadline passed, the page was drawn without
    /// it, and there is nobody left to tell.
    pub fn settle(&self, claimant: &str, id: u64, result: Result<Value, String>) -> Result<(), String> {
        let mut waiting = self.waiting.lock().expect("pending lock");

        let Some((owner, _)) = waiting.get(&id) else { return Ok(()) };
        if owner != claimant {
            return Err(format!("{claimant} answered a question put to {owner}"));
        }

        let Some((_, sender)) = waiting.remove(&id) else { return Ok(()) };
        drop(waiting);
        let _ = sender.send(result);
        Ok(())
    }

    pub fn forget(&self, id: u64) {
        self.waiting.lock().expect("pending lock").remove(&id);
    }

    /// Settles every question one plugin is holding, with a reason.
    ///
    /// Used by `stop`. The reason travels as an `Err`, which the waiter reads
    /// as an answer it did not like rather than as a deadline it missed - so
    /// a plugin is never put away for having been restarted.
    pub fn settle_all_of(&self, owner: &str, reason: &str) {
        let mut waiting = self.waiting.lock().expect("pending lock");
        let ids: Vec<u64> = waiting
            .iter()
            .filter(|(_, (who, _))| who == owner)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            if let Some((_, sender)) = waiting.remove(&id) {
                let _ = sender.send(Err(reason.to_string()));
            }
        }
    }

    /// How many questions are still open. For the tests.
    pub fn open(&self) -> usize {
        self.waiting.lock().expect("pending lock").len()
    }
}

/// The plugins whose own code has finished running.
///
/// A window exists the moment it is built and answers nothing for some
/// milliseconds after: it has a page to fetch and a module to run, and a
/// module is deferred by definition. Asking a plugin in that window reaches a
/// page with a runtime but no handlers, which looks exactly like a plugin
/// that ignored the question. So a plugin says when it is ready, and until it
/// does nothing is asked of it.
#[derive(Default)]
pub struct Started {
    names: Mutex<HashSet<String>>,
    woken: Condvar,
}

impl Started {
    /// Called when a plugin's own code has run.
    pub fn mark(&self, name: &str) {
        self.names.lock().expect("started lock").insert(name.to_string());
        self.woken.notify_all();
    }

    /// Waits for a plugin to be ready, or gives up at `deadline`.
    pub fn wait(&self, name: &str, deadline: Instant) -> bool {
        let mut names = self.names.lock().expect("started lock");
        while !names.contains(name) {
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            let (held, timed_out) = self
                .woken
                .wait_timeout(names, left)
                .expect("started lock");
            names = held;
            if timed_out.timed_out() && !names.contains(name) {
                return false;
            }
        }
        true
    }

    /// Forgets that a plugin ever finished starting.
    ///
    /// A restarted plugin is a new page with the same name, and nothing is
    /// asked of it until that page has said so for itself.
    pub fn forget(&self, name: &str) {
        self.names.lock().expect("started lock").remove(name);
        // Nothing is waiting *for* a removal, but a waiter holding the lock
        // must not be left holding a stale view of it.
        self.woken.notify_all();
    }
}

/// The question put to a plugin: what the app asked, with what only this
/// plugin is told merged in, and the three things the host owns written over
/// the top.
///
/// `per` is how a round of asking stops being one question. `page.section`
/// tells each plugin which of *its* sidecars exist for the day (spec §4.2),
/// so the frontend - which is where the manifests are read and where who owns
/// what is settled - hands over an object keyed by plugin name, and this takes
/// the caller's own entry. Rust learns nothing about sidecars by doing it: it
/// merges an object it was given.
///
/// Merged *before* the three below are written, so nothing a plugin is told
/// privately can talk over the id, the slot or the clock. The id last and
/// unconditionally, because an id a plugin could choose is an answer it could
/// put in another plugin's mouth. It lives beside `Pending` rather than
/// beside the `eval` that sends it because that is the other half of the
/// same argument: `Pending::ask_of` is what makes the id the host's to give,
/// `Pending::settle` is what checks the answer came back from the plugin it
/// was addressed to, and this is what puts the id where a plugin cannot talk
/// over it.
pub fn envelope(id: u64, slot: &str, now: &Value, params: &Value, name: &str) -> Value {
    let mut asked = match params {
        Value::Object(_) => params.clone(),
        // Not an error: the app's own windows build these, and a slot whose
        // question carries nothing beyond the time is a slot with no params.
        _ => Value::Object(Default::default()),
    };

    // Taken out whichever plugin is being asked, so no plugin is ever shown
    // the table - including the one whose entry it is, which would otherwise
    // learn the names of every other plugin that answers this slot.
    let per = asked.as_object_mut().and_then(|fields| fields.remove("per"));
    if let Some(mine) = per.as_ref().and_then(|per| per.get(name)).and_then(Value::as_object) {
        for (key, value) in mine {
            asked[key.as_str()] = value.clone();
        }
    }

    asked["kind"] = Value::from(slot);
    asked["now"] = now.clone();
    asked["id"] = Value::from(id);
    asked
}
