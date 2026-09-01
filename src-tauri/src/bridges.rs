//! Capability bridges: the native things a plugin may reach, one function per
//! capability, and nothing reachable that is not listed here.
//!
//! Anything native lives on this side (spec §7.3). A plugin is pure logic; it
//! asks, Rust decides. By the time a call arrives here the manifest check has
//! already passed - this file's job is only to do the thing.

mod calendar;

use serde_json::Value;

/// Performs a granted capability call.
///
/// One arm per capability, and a capability with no arm is a capability that
/// does not exist however a manifest asks for it.
pub fn dispatch(capability: &str, method: &str, params: &Value) -> Result<Value, String> {
    match (capability, method) {
        ("macos.calendar.read", "events") => calendar::events(params),
        _ => Err(format!("no bridge provides {capability}.{method}")),
    }
}
