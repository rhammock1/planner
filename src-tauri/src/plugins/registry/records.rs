//! The records a registry holds, apart from the holding of them.
//!
//! `Granting` is what the frontend hands over; `Grant` is what is kept; and
//! `PluginState` is what the pane is told. All three are descriptions rather
//! than behaviour, and separating them leaves `registry.rs` as the one thing
//! it is about: a locked map, and the rules for reading it.

use serde::Serialize;
use serde_json::Value;

/// What the frontend hands over to start a plugin, as one record.
///
/// One shape rather than a parameter list, because this grew a field twice in
/// one phase and each time that meant the same edit in eight places - four of
/// them in the other language. `plan()` in `core/plugins.js` builds it; every
/// field here is a decision that file already made.
#[derive(serde::Deserialize, Default)]
pub struct Granting {
    pub name: String,
    pub entry: String,
    pub slots: Vec<String>,
    pub capabilities: Vec<String>,
    pub open: Vec<String>,
    pub run: Vec<crate::plugins::run::Command>,
    pub asked: Vec<String>,
    #[serde(rename = "askedRun")]
    pub asked_run: Vec<String>,
    pub settings: Value,
}

pub(super) struct Grant {
    /// The file the plugin starts at, from its manifest.
    pub(super) entry: String,
    /// The questions this plugin may be put, worked out in the frontend from
    /// the manifest and the config: declared and approved.
    pub(super) slots: Vec<String>,
    /// The intersection of what the manifest asked for and what the config
    /// granted, worked out in the frontend where the one TOML reader lives.
    pub(super) capabilities: Vec<String>,
    /// The addresses this plugin may ask the app to open, agreed entry for
    /// entry between the manifest and the config.
    pub(super) open: Vec<String>,
    /// The commands this plugin may run, agreed line for line between the
    /// manifest and the config, with every placeholder's rule already
    /// settled by the frontend.
    pub(super) run: Vec<crate::plugins::run::Command>,
    /// What the manifest *asked* for, approved or not - capabilities, and the
    /// names of the commands it declares.
    ///
    /// Kept because a refusal has to know which of two things it is. Asking
    /// for something you declared and the person has not ticked is a decision
    /// nobody has made yet; asking for something you never declared is a
    /// plugin that is not what it said it was. Only the second earns a strike
    /// (spec §1.2).
    pub(super) asked: Vec<String>,
    pub(super) asked_run: Vec<String>,
    /// This plugin's own settings, checked against its manifest's schema and
    /// settled by the frontend - the page it is served carries them.
    pub(super) settings: Value,
    /// What the plugin's page said it actually handles, from `ready`. `None`
    /// until it has said so.
    pub(super) handles: Option<Vec<String>>,
    /// Requests for something never granted. A plugin asking once may have a
    /// stale manifest; asking repeatedly is not a misunderstanding.
    pub(super) strikes: u32,
    pub(super) disabled: bool,
    /// Why it was put away, for the pane to show. A person who switches a
    /// plugin off and on again does not know what it did (spec §1.2).
    pub(super) reason: Option<String>,
    /// Whether its webview is up. A stop is not a judgement, so it is kept
    /// apart from `disabled`, which is.
    pub(super) running: bool,
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
