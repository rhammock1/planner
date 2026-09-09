//! `vault.sidecar.read`: the files a plugin owns, and nothing else.
//!
//! A plugin owns a sidecar by having declared its prefix, and the frontend
//! settled who owns what before this plugin was ever started. So the check
//! here is one line - and it is the only line between somebody else's code and
//! a folder of somebody's notes, which is why it is not a string prefix:
//! `meeting` must not be handed `meetings-elsewhere`.
//!
//! Read only. There is no `vault.sidecar.write` and nothing here writes: a
//! plugin names a sidecar, and the app holds the pen (spec §4.1).

use serde_json::Value;
use tauri::Manager;

use crate::bridges::calendar;
use crate::plugins::Registry;
use crate::vault_io::sidecars;

/// The widest range a plugin may ask for at once.
///
/// A provider searching sixty days either side of today asks for a hundred and
/// twenty; a year is room to grow into. Beyond it the call is refused rather
/// than truncated, because a plugin that thinks it read four years and read one
/// would be wrong quietly.
const WIDEST: i64 = 366;

/// The most sidecars one listing hands back.
const MOST: usize = 500;

/// Whether a suffix belongs to one of these prefixes.
///
/// The prefix itself, or the prefix and a hyphen. Mirrors `owns` in
/// `src/core/sidecars.js`; public so the tests can reach the rule without an
/// app handle.
pub fn owned(prefixes: &[String], suffix: &str) -> bool {
    prefixes
        .iter()
        .any(|prefix| suffix == prefix || suffix.starts_with(&format!("{prefix}-")))
}

/// `list({from, to})` - every sidecar of this plugin's, between two dates.
pub fn list(app: &tauri::AppHandle, plugin: &str, params: &Value) -> Result<Value, String> {
    let from = text(params, "from")?;
    let to = text(params, "to")?;

    // `calendar::days_between` already does the civil-day arithmetic this
    // needs, and disagreeing with it about what a day is would be a second
    // rule for the same question.
    let span = calendar::days_between(&from, &to)
        .ok_or_else(|| format!("{from} to {to} is not a range of days"))?
        .abs();
    if span > WIDEST {
        return Err(format!("a range wider than {WIDEST} days is more than one call may ask for"));
    }

    let prefixes = app.state::<Registry>().prefixes_of(plugin);
    if prefixes.is_empty() {
        // Not an error. A plugin with no `[sidecars]` table owns nothing, and
        // owning nothing is a complete and correct answer to this question.
        return Ok(Value::Array(Vec::new()));
    }

    let Some(root) = crate::vault::root(app) else { return Err("no vault is open".into()) };
    let mut found: Vec<sidecars::Sidecar> = sidecars::list(&root, &from, &to)
        .into_iter()
        .filter(|one| owned(&prefixes, &one.suffix))
        .collect();

    // The newest kept, because a provider that hits the cap is looking for
    // something recent far more often than something from two years ago.
    if found.len() > MOST {
        found = found.split_off(found.len() - MOST);
    }
    serde_json::to_value(found).map_err(|error| error.to_string())
}

/// `read(date, suffix)` - one of this plugin's sidecars, as text.
pub fn read(app: &tauri::AppHandle, plugin: &str, params: &Value) -> Result<Value, String> {
    let date = text(params, "date")?;
    let suffix = text(params, "suffix")?;

    let prefixes = app.state::<Registry>().prefixes_of(plugin);
    if !owned(&prefixes, &suffix) {
        // Not yours - see `no_such`.
        return Err(no_such(&date, &suffix));
    }

    let Some(root) = crate::vault::root(app) else { return Err("no vault is open".into()) };
    match sidecars::read(&root, &date, &suffix) {
        Some(text) => Ok(Value::from(text)),
        None => Err(no_such(&date, &suffix)),
    }
}

/// The sentence a plugin gets for a sidecar it cannot have.
///
/// One function, called from both refusals, because the two must be
/// indistinguishable and two `format!` calls that merely happen to match
/// are one careless edit away from not matching. A file that is not there
/// and a file that is not yours read the same, deliberately: which of the
/// two it is is not a plugin's business (spec §4.1).
fn no_such(date: &str, suffix: &str) -> String {
    format!("there is no {suffix} on {date}")
}

/// One string parameter, or a message saying which one was missing.
fn text(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("{key} is missing, or is not a string"))
}
