//! `planner.storage` - a plugin's own small file, and nothing else's.
//!
//! One JSON object per plugin at `~/.planner/state/<name>.json`, written the
//! way a page is written: a temporary file renamed over the target, so a
//! crash or a full disk leaves the previous file exactly as it was.
//!
//! This is the one capability that is never ticked. Every other one reaches
//! something outside the app - a calendar, a shell, a coordinate, somebody
//! else's writing - and a tick is how a person decides about reach. This
//! reaches nothing: the file did not exist before the plugin wrote it, it is
//! named after the plugin, and no other plugin and no part of the app ever
//! reads it. A tick on it would ask a person to make a decision with no other
//! side, and a settings pane that asks for those is a pane people stop
//! reading.
//!
//! What still has to be true, and is enforced here rather than assumed:
//! - the name is a plugin name, so nothing climbs out of `state/`;
//! - the file is one JSON object, so `get` cannot be handed a list and
//!   quietly return nothing;
//! - the whole file stays under the cap, so a plugin cannot fill the disk one
//!   `set` at a time.

use std::path::PathBuf;

use serde_json::{Map, Value};

/// The most one plugin's file may come to, serialised.
///
/// 64 KiB, which is a great deal of the kind of thing this is for - `pet`'s
/// whole seven-day history is four numbers a day - and small enough that
/// every plugin on a machine filling its file costs less than one photograph.
/// The cap is on the file rather than on a value, because a value cap is a
/// cap a plugin walks around with a second key.
pub const MOST: usize = 64 * 1024;

/// The longest a key may be.
///
/// The file is meant to be readable by the person whose disk it is on, and a
/// key longer than a line of prose is not. Nothing depends on the number.
pub const LONGEST_KEY: usize = 128;

/// Lowercase letters, digits and hyphens, starting with one of the first two.
///
/// The same rule `src/core/plugins.js` applies to a folder, said again on
/// this side. The name arrives from the window label and so is already a
/// plugin the app started, but this function is what stands between a name
/// and a path: a name with a `/` or a `..` in it would name a file outside
/// `state/`, and "it cannot happen" is not a thing to leave to the caller.
fn is_plugin_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let mut bytes = name.bytes();
    let first = bytes.next().unwrap_or(b'-');
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Where this plugin's file is, or `None` for a name that may not have one.
fn path_for(plugin: &str) -> Option<PathBuf> {
    if !is_plugin_name(plugin) {
        return None;
    }
    crate::settings::planner_dir().map(|dir| dir.join("state").join(format!("{plugin}.json")))
}

/// The key a call is about.
fn key_of(params: &Value) -> Result<String, String> {
    let key = params.get("key").and_then(Value::as_str).unwrap_or("");
    if key.is_empty() {
        return Err("storage needs a key".to_string());
    }
    if key.len() > LONGEST_KEY {
        return Err(format!("a storage key may be at most {LONGEST_KEY} bytes"));
    }
    Ok(key.to_string())
}

/// This plugin's whole file, as an object.
///
/// A file that is not there is an empty object - a plugin's first run is not
/// an error. A file that is there and will not parse is an error naming the
/// path, and deliberately not an empty object: treating it as empty would
/// make the next `set` destroy whatever a person had in there, silently, and
/// the only fix a person can apply is one they have to be told about.
fn read(plugin: &str) -> Result<Map<String, Value>, String> {
    let path = path_for(plugin).ok_or("that plugin has no storage")?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(format!("{}: {error}", path.display())),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(held)) => Ok(held),
        Ok(_) => Err(format!("{} is not a JSON object; delete it to start again", path.display())),
        Err(error) => {
            Err(format!("{} could not be read: {error}; delete it to start again", path.display()))
        }
    }
}

/// One value out of this plugin's file.
///
/// `null` for a key nobody has set, which is the same answer as a key set to
/// `null` - see `set`, where that is the point rather than a collision.
pub fn get(plugin: &str, params: &Value) -> Result<Value, String> {
    let key = key_of(params)?;
    Ok(read(plugin)?.get(&key).cloned().unwrap_or(Value::Null))
}

/// One value into this plugin's file.
///
/// `null` removes the key rather than storing a null. `get` cannot tell a
/// stored null from an absent key, so storing one would leave the file
/// carrying something no reader can observe - and a plugin that sets a key it
/// no longer wants would have no way to stop paying for it against the cap.
///
/// The cap is checked against the file this write would make, before it is
/// made: a refusal leaves the previous file exactly as it was, and says what
/// the cap is, because a plugin that is over it has to decide what to drop.
pub fn set(plugin: &str, params: &Value) -> Result<Value, String> {
    let key = key_of(params)?;
    let path = path_for(plugin).ok_or("that plugin has no storage")?;
    let mut held = read(plugin)?;

    match params.get("value").unwrap_or(&Value::Null) {
        Value::Null => {
            held.remove(&key);
        }
        value => {
            held.insert(key, value.clone());
        }
    }

    let text = serde_json::to_string_pretty(&Value::Object(held))
        .map_err(|error| format!("that will not go into storage: {error}"))?;
    if text.len() > MOST {
        return Err(format!(
            "{plugin}'s storage would come to {} bytes, and the most it may hold is {MOST}",
            text.len()
        ));
    }

    crate::vault_io::write_atomic(&path, &text)
        .map_err(|error| format!("{}: {error}", path.display()))?;
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// `PLANNER_HOME` is process-wide, so these tests hold one lock rather
    /// than running in parallel.
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Points `planner_dir()` at a directory of this test's own, and hands
    /// back its path.
    ///
    /// Each test takes its own sub-directory as well as the lock: a leaked
    /// write from one must not be readable by the next, or "two plugins
    /// cannot see each other's file" would pass for the wrong reason.
    fn home(named: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("planner-storage-{named}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("test home");
        std::env::set_var("PLANNER_HOME", &dir);
        dir
    }

    #[test]
    fn a_value_comes_back_out() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        home("round-trip");
        set("pet", &json!({"key": "history", "value": [1, 2, 3]})).expect("set");
        assert_eq!(get("pet", &json!({"key": "history"})).expect("get"), json!([1, 2, 3]));
    }

    /// The file is the whole point: a value has to survive the process that
    /// wrote it, or storage is a variable with extra steps.
    #[test]
    fn a_value_survives_a_restart() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        let dir = home("restart");
        set("pet", &json!({"key": "mood", "value": "resting"})).expect("set");

        let text = std::fs::read_to_string(dir.join("state").join("pet.json")).expect("the file");
        assert!(text.contains("resting"), "{text}");
        assert_eq!(get("pet", &json!({"key": "mood"})).expect("get"), json!("resting"));
    }

    #[test]
    fn a_key_nobody_set_is_null_rather_than_an_error() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        home("absent");
        assert_eq!(get("pet", &json!({"key": "nothing"})).expect("get"), Value::Null);
    }

    #[test]
    fn setting_null_removes_the_key() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        let dir = home("removal");
        set("pet", &json!({"key": "mood", "value": "fretting"})).expect("set");
        set("pet", &json!({"key": "mood", "value": Value::Null})).expect("unset");

        let text = std::fs::read_to_string(dir.join("state").join("pet.json")).expect("the file");
        assert!(!text.contains("mood"), "{text}");
    }

    #[test]
    fn a_write_over_the_cap_is_refused_and_changes_nothing() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        home("cap");
        set("pet", &json!({"key": "keep", "value": "this"})).expect("set");

        let huge = "x".repeat(MOST);
        let refusal = set("pet", &json!({"key": "huge", "value": huge})).expect_err("refused");
        assert!(refusal.contains(&MOST.to_string()), "{refusal}");

        // The refusal left the previous file alone, which is the half of the
        // promise a cap on its own does not make.
        assert_eq!(get("pet", &json!({"key": "keep"})).expect("get"), json!("this"));
        assert_eq!(get("pet", &json!({"key": "huge"})).expect("get"), Value::Null);
    }

    #[test]
    fn two_plugins_cannot_see_each_others_file() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        home("two");
        set("pet", &json!({"key": "mood", "value": "fresh"})).expect("set");
        set("dusk", &json!({"key": "mood", "value": "night"})).expect("set");

        assert_eq!(get("pet", &json!({"key": "mood"})).expect("get"), json!("fresh"));
        assert_eq!(get("dusk", &json!({"key": "mood"})).expect("get"), json!("night"));
    }

    /// The name arrives from the window label, so this cannot happen today.
    /// The test is what keeps it from happening the day something else calls
    /// this module.
    #[test]
    fn a_name_that_is_not_a_plugin_name_has_no_file() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        home("climbing");
        for name in ["../../evil", "..", "pet/../dusk", "Pet", "", "-pet"] {
            assert!(path_for(name).is_none(), "{name} was given a path");
            assert!(set(name, &json!({"key": "k", "value": 1})).is_err(), "{name} wrote");
        }
    }

    #[test]
    fn a_call_with_no_key_is_refused() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        home("keyless");
        assert!(get("pet", &json!({})).is_err());
        assert!(set("pet", &json!({"value": 1})).is_err());
        assert!(set("pet", &json!({"key": "x".repeat(LONGEST_KEY + 1), "value": 1})).is_err());
    }

    /// A file somebody hand-edited into nonsense is an error naming the path,
    /// not an empty object: the next `set` would otherwise wipe it without a
    /// word.
    #[test]
    fn a_file_that_will_not_parse_is_said_out_loud() {
        let _held = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        let dir = home("broken");
        std::fs::create_dir_all(dir.join("state")).expect("state");
        std::fs::write(dir.join("state").join("pet.json"), "{not json").expect("write");

        let refusal = get("pet", &json!({"key": "mood"})).expect_err("refused");
        assert!(refusal.contains("pet.json"), "{refusal}");
        assert!(set("pet", &json!({"key": "mood", "value": 1})).is_err());
    }
}
