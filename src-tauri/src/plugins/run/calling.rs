//! Performing a `shell.run` call (spec §3.2).
//!
//! The other half of `run.rs`: that file turns a manifest's command into an
//! argument list, and this one decides whether this plugin may run it, hands
//! it to `spawning`, and says what a refusal costs.
//!
//! Everything the frontend worked out arrives in the grant; everything about
//! it is checked again here, because this is the last line before a process
//! exists.

use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::super::spawning::{self, Finished, LIMIT, STDERR_CAP, STDOUT_CAP};
use super::super::Registry;
use super::{bind, Rule};

/// `shell.run`'s one method (spec §3.2).
///
/// Everything the frontend worked out arrives in the grant; the argument list
/// is derived again here, because this is the last line before a process
/// exists.
///
/// A strike is charged for one thing only: asking for something the plugin's
/// own manifest never declared, or sending a value that manifest would not
/// accept. Everything else a call can run into - not ticked, not running, a
/// setting nobody filled in, a grant this app built wrong - is a state of the
/// config or of the app, and charging a plugin for those puts a
/// correctly-written one away for the session with a reason pointing at the
/// wrong half of somebody's setup (spec §1.2, §6).
///
/// `params` is `{name, values: {placeholder: value}}`.
pub fn call(app: &AppHandle, plugin: &str, params: &Value) -> Result<Value, String> {
    let wanted = params.get("name").and_then(Value::as_str).unwrap_or("");
    let values = params.get("values").cloned().unwrap_or(Value::Null);

    let registry = app.state::<Registry>();

    // Switched off, or restarting because a setting changed while this call
    // was in the air. Never a strike: the plugin did nothing, the app moved
    // underneath it - the same reason `opening.rs` refuses a stale badge
    // without one.
    let Some(granted) = registry.run_of(plugin) else {
        return Err(format!("{plugin} is not running"));
    };

    let Some(command) = granted.into_iter().find(|one| one.name == wanted) else {
        // Declared and not ticked is a decision nobody has made yet. Never
        // declared is a plugin that is not what its manifest said it was, and
        // only that is worth a strike.
        if registry.declared_run(plugin, wanted) {
            return Err(format!(
                "{plugin} may not run {wanted} until it is ticked in settings"
            ));
        }
        return Err(struck(
            app, plugin,
            format!("{plugin} may not run {wanted}"),
            "asked three times to run something it never declared",
        ));
    };

    // Before binding, and deliberately not a strike: a `settings.<key>` the
    // person has not filled in is a row in the pane waiting to be typed into,
    // not a plugin misbehaving. Three of these would otherwise put a
    // correctly-written plugin away on the day it was installed - which is the
    // one day it is certain to hit them.
    if let Some(missing) = command.binds.iter().find_map(|held| match &held.rule {
        Rule::Setting { key, value: None } => Some(key.clone()),
        _ => None,
    }) {
        return Err(format!(
            "{plugin}: the {missing} setting is not set, so {wanted} cannot be run"
        ));
    }

    // The one part of a call the plugin actually supplies, checked here so the
    // refusal lands on the right party. `bind` refuses six different things
    // and five of them come out of the grant this app built - striking a
    // plugin for those would be charging it for our own mistake.
    for one in &command.binds {
        if !matches!(one.rule, Rule::Date) {
            continue;
        }
        let given = values.get(&one.name).and_then(Value::as_str);
        if !given.is_some_and(super::is_day) {
            return Err(struck(
                app, plugin,
                format!(
                    "{plugin}: {{{}}} must be a day, and {} is not one",
                    one.name,
                    given.unwrap_or("nothing"),
                ),
                "sent a value three times that was not a day",
            ));
        }
    }

    let home = crate::settings::home_dir().ok_or("this Mac has no home directory")?;
    // Whatever is left for `bind` to refuse is this app's own doing, so it is
    // reported and not charged.
    let args = bind(&command, &values, &home).map_err(|refusal| format!("{plugin}: {refusal}"))?;

    let Some((program, rest)) = args.split_first() else {
        return Err(format!("{plugin}: {wanted} has nothing to run"));
    };
    // Not a strike: a machine without `git` on its PATH is not a plugin
    // behaving badly, and the person is the one who can do something about it.
    let found = spawning::resolve(program, spawning::login_path(), crate::settings::planner_dir().as_deref())
        .map_err(|refusal| format!("{plugin}: {refusal}"))?;

    let mut process = std::process::Command::new(&found);
    process
        .args(rest)
        // The home directory, not the vault and not the app's: a command runs
        // where a person's shell would start, and nowhere nearer this app.
        .current_dir(&home)
        // Everything else is deliberately gone. A plugin's command inherits no
        // token, no proxy and no editor from whatever launched Planner.
        .env_clear()
        .envs(environment(&home));

    let done = spawning::limited(&mut process, LIMIT, (STDOUT_CAP, STDERR_CAP))
        .map_err(|error| format!("{plugin}: {wanted} {error}"))?;
    Ok(answer(done))
}

/// The whole environment a command is given: three variables and no more.
///
/// Its own function because that is a promise worth a test rather than a line
/// in the middle of one (spec §7). Everything a process usually inherits -
/// a token in an environment variable, a proxy, an editor, a `GIT_*` of any
/// kind - is deliberately absent, because Planner may have been launched from
/// a terminal that had all of them.
pub fn environment(home: &Path) -> Vec<(String, String)> {
    vec![
        ("PATH".to_string(), spawning::login_path().to_string()),
        ("HOME".to_string(), home.to_string_lossy().into_owned()),
        // The one thing inherited, because a command that reports dates and
        // names should report them the way the rest of this Mac does.
        (
            "LANG".to_string(),
            std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()),
        ),
    ]
}

/// What a finished command looks like to the plugin that asked for it.
///
/// Lossy on purpose: a program is not obliged to speak UTF-8, and a plugin
/// handed a failed call instead of a string could do nothing useful with it.
pub fn answer(done: Finished) -> Value {
    json!({
        "status": done.status,
        "stdout": String::from_utf8_lossy(&done.stdout),
        "stderr": String::from_utf8_lossy(&done.stderr),
    })
}

/// Records a strike, puts the plugin away if that was the third, and hands the
/// refusal back unchanged so the caller can return it.
///
/// `why` is carried separately from `refusal` because they are read by
/// different people at different times: the refusal goes back to the plugin,
/// and `why` is the sentence the settings pane shows a person a week later,
/// under a plugin that stopped working. "Asked for something it was not
/// granted" said about a plugin that sent a malformed date would send that
/// person looking at the wrong half of their config (spec §1.2).
fn struck(app: &AppHandle, plugin: &str, refusal: String, why: &str) -> String {
    eprintln!("planner: {refusal}");
    if app.state::<Registry>().strike(plugin) {
        super::super::host::put_away(app, plugin, why);
    }
    refusal
}
