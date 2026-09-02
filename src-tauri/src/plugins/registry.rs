//! What each running plugin was granted, and whether it is still trusted.
//!
//! Pure state, and deliberately so: nothing here knows about a window or an
//! app handle. Putting a plugin away is two things - a judgement recorded
//! here, and a webview closed in `host.rs` - and only the first belongs in a
//! type the tests can build on their own.

use std::collections::HashMap;
use std::sync::Mutex;

/// How many ungranted requests a plugin gets before it is put away.
pub const STRIKES: u32 = 3;

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
