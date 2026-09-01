//! Capability bridges: the native things a plugin may reach, one function per
//! capability, and nothing reachable that is not listed here.
//!
//! Anything native lives on this side (spec §7.3). A plugin is pure logic; it
//! asks, Rust decides. By the time a call arrives here the manifest check has
//! already passed - this file's job is only to do the thing.

use serde_json::Value;

/// Performs a granted capability call.
pub fn dispatch(capability: &str, method: &str, _params: &Value) -> Result<Value, String> {
    Err(format!("no bridge provides {capability}.{method}"))
}
