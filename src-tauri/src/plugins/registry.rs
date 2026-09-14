//! What each running plugin was granted, and whether it is still trusted.
//!
//! Pure state, and deliberately so: nothing here knows about a window or an
//! app handle. Putting a plugin away is two things - a judgement recorded
//! here, and a webview closed in `host.rs` - and only the first belongs in a
//! type the tests can build on their own.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;

mod records;

pub use records::{Granting, PluginState};
use records::Grant;

/// How many ungranted requests a plugin gets before it is put away.
pub const STRIKES: u32 = 3;

/// What each running plugin was granted, and whether it is still trusted.
#[derive(Default)]
pub struct Registry(Mutex<HashMap<String, Grant>>);

impl Registry {
    /// Records what a plugin may reach. Called by the app's own window, which
    /// read the manifest and the config; never by a plugin, which cannot
    /// reach this command at all.
    ///
    /// A judgement already made is kept. Being put away is about how the code
    /// behaved, not about what the config says it may have, and the person
    /// switching a plugin off and on again does not know what it did. Whether
    /// it has said `ready` yet is kept too - a restart clears it (Task 5
    /// calls `stop` first), but a second `grant` on a running plugin must not
    /// make it look as though it never said ready.
    pub fn grant(&self, granting: Granting) {
        let Granting {
            name, entry, slots, capabilities, open, run, asked, asked_run, prefixes, settings,
        } = granting;
        let name = name.as_str();
        let mut held = self.0.lock().expect("registry lock");
        let kept = held
            .get(name)
            .map(|grant| (grant.strikes, grant.disabled, grant.reason.clone(), grant.handles.clone()));
        let (strikes, disabled, reason, handles) = kept.unwrap_or((0, false, None, None));
        held.insert(
            name.to_string(),
            Grant {
                entry,
                slots,
                capabilities,
                open,
                run,
                asked,
                asked_run,
                prefixes,
                settings,
                handles,
                strikes,
                disabled,
                reason,
                running: true,
            },
        );
    }

    pub fn entry_of(&self, name: &str) -> Option<String> {
        let held = self.0.lock().expect("registry lock");
        held.get(name).map(|grant| grant.entry.clone())
    }

    /// A plugin's own settings, as the page it is served will carry them.
    pub fn settings_of(&self, name: &str) -> Value {
        let held = self.0.lock().expect("registry lock");
        held.get(name)
            .map(|grant| grant.settings.clone())
            // An object, never null: the page writes it into
            // `Object.freeze(...)`, and `Object.freeze(null)` is null, which a
            // plugin reading `planner.settings.pattern` would throw on.
            .unwrap_or_else(|| Value::Object(Default::default()))
    }

    /// The plugins worth putting this question to: started, not put away, and
    /// granted the slot.
    ///
    /// The grant is what is read, not what the plugin registered. Registering
    /// a handler is a plugin's own business; being asked is the config's.
    pub fn running_for(&self, slot: &str) -> Vec<String> {
        let held = self.0.lock().expect("registry lock");
        let mut names: Vec<String> = held
            .iter()
            .filter(|(_, grant)| {
                grant.running && !grant.disabled && grant.slots.iter().any(|one| one == slot)
            })
            .map(|(name, _)| name.clone())
            .collect();
        // Stable order, so two runs answer in the same order and a section
        // does not shuffle between launches.
        names.sort();
        names
    }

    /// Records what a plugin's page said it handles, from `ready`.
    pub fn registered(&self, name: &str, slots: Vec<String>) {
        let mut held = self.0.lock().expect("registry lock");
        if let Some(grant) = held.get_mut(name) {
            grant.handles = Some(slots);
        }
    }

    /// Slots the plugin was granted and never registered a handler for.
    ///
    /// Empty until the plugin has said `ready`: before that, a slot with no
    /// handler is a plugin that has not finished loading.
    pub fn unhandled(&self, name: &str) -> Vec<String> {
        let held = self.0.lock().expect("registry lock");
        let Some(grant) = held.get(name) else { return Vec::new() };
        let Some(handles) = grant.handles.as_ref() else { return Vec::new() };
        grant
            .slots
            .iter()
            .filter(|slot| !handles.iter().any(|one| &one == slot))
            .cloned()
            .collect()
    }

    /// A capability every running plugin has, that no manifest declares and
    /// no tick grants.
    ///
    /// `planner.storage` is one file, named after the plugin, that nothing
    /// else on the machine reads - so there is no decision for a person to
    /// make about it, and a tick that grants nothing teaches people to tick
    /// without reading. It is still a capability in every other respect: it
    /// goes through the door, it is refused to a plugin that has been put
    /// away, and `bridges::dispatch` is the only thing that performs it.
    const UNGATED: &'static [&'static str] = &["planner.storage"];

    /// Whether a plugin may use a capability right now.
    pub fn permits(&self, name: &str, capability: &str) -> bool {
        let held = self.0.lock().expect("registry lock");
        held.get(name).is_some_and(|grant| {
            !grant.disabled
                && (Self::UNGATED.contains(&capability)
                    || grant.capabilities.iter().any(|held| held == capability))
        })
    }

    /// What a plugin may ask the app to open. Empty for a plugin that was
    /// never started, for one put away, and for one that has been stopped.
    ///
    /// `running` as well as `!disabled` - unlike `permits`, which gates a
    /// live plugin's own capability calls. This one gates a click in the
    /// app's own UI on a badge that may be stale, so switching a plugin off
    /// must withdraw its addresses at once rather than leaving the last
    /// grant answerable until something happens to overwrite it.
    pub fn may_open(&self, name: &str) -> Vec<String> {
        let held = self.0.lock().expect("registry lock");
        held.get(name)
            .filter(|grant| grant.running && !grant.disabled)
            .map(|grant| grant.open.clone())
            .unwrap_or_default()
    }

    /// What a plugin may run right now.
    ///
    /// `running` as well as `!disabled`, for the same reason `may_open` reads
    /// both: switching a plugin off has to withdraw what it may reach at once.
    pub fn run_of(&self, name: &str) -> Option<Vec<super::run::Command>> {
        let held = self.0.lock().expect("registry lock");
        held.get(name)
            .filter(|grant| grant.running && !grant.disabled)
            .map(|grant| grant.run.clone())
    }

    /// The sidecar suffixes a plugin owns right now.
    ///
    /// `running` as well as `!disabled`, for the same reason `may_open` reads
    /// both: switching a plugin off has to withdraw what it may reach at once,
    /// and what it may reach here is a set of files.
    pub fn prefixes_of(&self, name: &str) -> Vec<String> {
        let held = self.0.lock().expect("registry lock");
        held.get(name)
            .filter(|grant| grant.running && !grant.disabled)
            .map(|grant| grant.prefixes.clone())
            .unwrap_or_default()
    }

    /// Whether the plugin's own manifest asked for this capability, whatever
    /// the config then said about it.
    ///
    /// The difference between a refusal and a strike, which is why this and
    /// its sibling below are two functions rather than one taking the list to
    /// look in as a string. Written that way, any value that was not the
    /// expected one silently fell through to the capabilities - so a typo
    /// decided a plugin's fate the wrong way round, and nothing said so.
    pub fn declared_capability(&self, name: &str, wanted: &str) -> bool {
        self.declared(name, wanted, false)
    }

    /// Whether the plugin's own manifest declared this command.
    ///
    /// A separate namespace from the capabilities on purpose: a command named
    /// `shell.run` must not be able to launder itself into the capability of
    /// the same name.
    pub fn declared_run(&self, name: &str, wanted: &str) -> bool {
        self.declared(name, wanted, true)
    }

    fn declared(&self, name: &str, wanted: &str, among_run: bool) -> bool {
        let held = self.0.lock().expect("registry lock");
        held.get(name).is_some_and(|grant| {
            let list = if among_run { &grant.asked_run } else { &grant.asked };
            list.iter().any(|one| one == wanted)
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
    pub fn disable(&self, name: &str, reason: &str) {
        let mut held = self.0.lock().expect("registry lock");
        if let Some(grant) = held.get_mut(name) {
            grant.disabled = true;
            // The first reason is the true one. A plugin already put away for
            // hanging that is then refused a capability was not put away for
            // asking.
            grant.reason.get_or_insert_with(|| reason.to_string());
        }
    }

    pub fn disabled(&self, name: &str) -> bool {
        let held = self.0.lock().expect("registry lock");
        held.get(name).map(|grant| grant.disabled).unwrap_or(true)
    }

    /// Takes a plugin off the list of things worth asking, without forgiving
    /// anything. Its strikes, its disabling and the reason all stay.
    pub fn stop(&self, name: &str) {
        let mut held = self.0.lock().expect("registry lock");
        if let Some(grant) = held.get_mut(name) {
            grant.running = false;
            // Its next page will say for itself what it handles.
            grant.handles = None;
        }
    }

    /// Every plugin this session has started, whether or not it still is.
    pub fn states(&self) -> Vec<PluginState> {
        let held = self.0.lock().expect("registry lock");
        let mut states: Vec<PluginState> = held
            .iter()
            .map(|(name, grant)| PluginState {
                name: name.clone(),
                running: grant.running && !grant.disabled,
                disabled: grant.disabled,
                reason: grant.reason.clone(),
            })
            .collect();
        states.sort_by(|left, right| left.name.cmp(&right.name));
        states
    }
}
