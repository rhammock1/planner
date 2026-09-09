//! Capability bridges: the native things a plugin may reach, one function per
//! capability, and nothing reachable that is not listed here.
//!
//! Anything native lives on this side (spec §7.3). A plugin is pure logic; it
//! asks, Rust decides. By the time a call arrives here the manifest check has
//! already passed - this file's job is only to do the thing.

pub mod calendar;
pub mod location;
pub mod sidecars;

use serde_json::Value;

/// Performs a granted capability call.
///
/// One arm per capability, and a capability with no arm is a capability that
/// does not exist however a manifest asks for it.
///
/// The app handle and the caller's name are both here because a capability
/// that carries a list needs them: `shell.run` has to read the commands *this*
/// plugin was granted, and a refused binding is a strike against *this* plugin
/// (spec §3.2). The name is the window label's, never anything the message
/// claimed to be.
pub fn dispatch(
    app: &tauri::AppHandle,
    plugin: &str,
    capability: &str,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    match (capability, method) {
        ("macos.calendar.read", "events") => calendar::events(params),
        ("macos.location.read", "location") => location::location(app),
        ("shell.run", "run") => crate::plugins::run::call(app, plugin, params),
        ("vault.sidecar.read", "list") => sidecars::list(app, plugin, params),
        ("vault.sidecar.read", "read") => sidecars::read(app, plugin, params),
        _ => Err(format!("no bridge provides {capability}.{method}")),
    }
}
