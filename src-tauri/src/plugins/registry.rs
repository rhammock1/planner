//! What each running plugin was granted, and whether it is still trusted.
//!
//! Pure state, and deliberately so: nothing here knows about a window or an
//! app handle. Putting a plugin away is two things - a judgement recorded
//! here, and a webview closed in `host.rs` - and only the first belongs in a
//! type the tests can build on their own.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

/// How many ungranted requests a plugin gets before it is put away.
pub const STRIKES: u32 = 3;

/// What each running plugin was granted, and whether it is still trusted.
#[derive(Default)]
pub struct Registry(Mutex<HashMap<String, Grant>>);

struct Grant {
    /// The file the plugin starts at, from its manifest.
    entry: String,
    /// The questions this plugin may be put, worked out in the frontend from
    /// the manifest and the config: declared and approved.
    slots: Vec<String>,
    /// The intersection of what the manifest asked for and what the config
    /// granted, worked out in the frontend where the one TOML reader lives.
    capabilities: Vec<String>,
    /// The addresses this plugin may ask the app to open, agreed entry for
    /// entry between the manifest and the config.
    open: Vec<String>,
    /// This plugin's own settings, checked against its manifest's schema and
    /// settled by the frontend - the page it is served carries them.
    settings: Value,
    /// What the plugin's page said it actually handles, from `ready`. `None`
    /// until it has said so.
    handles: Option<Vec<String>>,
    /// Requests for something never granted. A plugin asking once may have a
    /// stale manifest; asking repeatedly is not a misunderstanding.
    strikes: u32,
    disabled: bool,
    /// Why it was put away, for the pane to show. A person who switches a
    /// plugin off and on again does not know what it did (spec §1.2).
    reason: Option<String>,
    /// Whether its webview is up. A stop is not a judgement, so it is kept
    /// apart from `disabled`, which is.
    running: bool,
}

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
    pub fn grant(
        &self,
        name: &str,
        entry: String,
        slots: Vec<String>,
        capabilities: Vec<String>,
        open: Vec<String>,
        settings: Value,
    ) {
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

    /// Whether a plugin may use a capability right now.
    pub fn permits(&self, name: &str, capability: &str) -> bool {
        let held = self.0.lock().expect("registry lock");
        held.get(name).is_some_and(|grant| {
            !grant.disabled && grant.capabilities.iter().any(|held| held == capability)
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

/// What the pane needs to know about a plugin that is not in either file.
///
/// The reason is the interesting part. A judgement about how somebody's code
/// behaved should not be cleared by a person who does not know what it did,
/// so the switch does not clear it - which makes telling them what it was the
/// only decent thing left to do (spec §1.2).
#[derive(Serialize)]
pub struct PluginState {
    pub name: String,
    pub running: bool,
    pub disabled: bool,
    pub reason: Option<String>,
}
