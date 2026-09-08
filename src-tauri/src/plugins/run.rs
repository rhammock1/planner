//! `shell.run` (spec §3.2): binding a command a manifest declared, and running
//! it without a shell.
//!
//! This file is the boundary. By the time a `Vec<String>` leaves `bind` there
//! is nothing between a plugin and a process, so everything the JavaScript
//! side worked out is worked out again here - not because that side is
//! untrusted, but because this side is the one that has to be right.
//!
//! There is no shell anywhere in it. The command is an argument list, the
//! placeholders are substituted inside single arguments, and the program is
//! handed to the operating system as a path. A plugin cannot make two
//! arguments out of one, cannot choose the program, and cannot reach anything
//! the manifest did not name and the config did not tick.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::spawning::{self, Finished, LIMIT, STDERR_CAP, STDOUT_CAP};
use super::Registry;

/// How a placeholder's value is checked before it is substituted.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "rule", rename_all = "camelCase")]
pub enum Rule {
    /// The value must be a written-down day, `YYYY-MM-DD`.
    Date,
    /// The value must be exactly the setting's, as the *person* set it.
    ///
    /// `None` is a setting nobody has set. The frontend sends it that way
    /// rather than dropping the command, so the refusal can name the setting
    /// that is missing instead of saying the command does not exist.
    Setting { key: String, value: Option<String> },
}

/// One placeholder, and how it is bound.
#[derive(Deserialize, Clone, Debug)]
pub struct Bind {
    pub name: String,
    #[serde(flatten)]
    pub rule: Rule,
}

/// A command a plugin may run, as the frontend settled it from the manifest
/// and the config.
#[derive(Deserialize, Clone, Debug)]
pub struct Command {
    pub name: String,
    pub command: Vec<String>,
    pub binds: Vec<Bind>,
}

/// The argument list a call comes down to, or why it does not.
///
/// One pass, left to right, over each argument of the template. What is
/// substituted in is never read again - so a value that happens to contain
/// `{repo}` is a value, not a hole, and no amount of nesting gets a plugin a
/// second substitution.
///
/// The whole call is refused if any rule fails. A command that ran with one
/// argument missing would not be the command that was approved.
///
/// A placeholder is filled from one of two places, and which one is the rule's
/// business rather than the caller's. A `date` comes from the call, because
/// only the plugin knows which day it is answering about. A `settings.<key>`
/// comes from the grant, because the grant is the only value it could have.
///
/// `values` is what the plugin passed - one per `date` placeholder, and
/// nothing else is read.
pub fn bind(command: &Command, values: &Value, home: &Path) -> Result<Vec<String>, String> {
    let Some(program) = command.command.first() else {
        return Err(format!("{} has no program to run", command.name));
    };
    // The program is fixed. The pane shows the rendered line and the tick
    // beside it is the approval, and a bound program is one nobody could see.
    if program.contains('{') || program.contains('}') {
        return Err(format!("{} would choose the program it runs", command.name));
    }

    let mut bound: Vec<(String, String)> = Vec::new();
    for one in &command.binds {
        match &one.rule {
            Rule::Date => {
                let given = values
                    .get(&one.name)
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("{} was not given a value for {{{}}}", command.name, one.name))?;
                if !is_day(given) {
                    return Err(format!("{{{}}} must be a day, and {given} is not one", one.name));
                }
                bound.push((one.name.clone(), given.to_string()));
            }
            Rule::Setting { key, value } => {
                let Some(held) = value else {
                    return Err(format!(
                        "the {key} setting has not been set, so {} cannot be run",
                        command.name
                    ));
                };
                // From the grant, and the call is not consulted. The grant
                // fixes the only value this placeholder can hold, so anything
                // passed in could only be a copy of a string the host handed
                // the plugin a moment earlier - and a string checked against
                // itself is not a check.
                //
                // It was one until this plan changed it, and it was a trap: a
                // `count` setting reaches a plugin as a number, sending it
                // back as one fails `as_str`, and three of those put the
                // plugin away for the session. Code that read as correct.
                //
                // Expanded here because there is no shell to do it, and the
                // example config would otherwise hand `git` a literal tilde.
                bound.push((one.name.clone(), expand(held, home)));
            }
        }
    }

    command
        .command
        .iter()
        .map(|argument| substitute(argument, &bound))
        .collect()
}

/// One argument, with every `{name}` in it replaced by its bound value.
///
/// A placeholder that opened in this argument and did not close in it is
/// refused rather than read across: that is the one thing an argument list
/// exists to prevent.
fn substitute(argument: &str, bound: &[(String, String)]) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = argument;

    loop {
        let Some(opens) = rest.find('{') else {
            if rest.contains('}') {
                return Err(format!("{argument} closes a placeholder it did not open"));
            }
            out.push_str(rest);
            return Ok(out);
        };
        let before = &rest[..opens];
        if before.contains('}') {
            return Err(format!("{argument} closes a placeholder it did not open"));
        }
        out.push_str(before);

        let after = &rest[opens + 1..];
        let Some(closes) = after.find('}') else {
            return Err(format!("{argument} opens a placeholder it does not close"));
        };
        let name = &after[..closes];
        let Some((_, value)) = bound.iter().find(|(bound_name, _)| bound_name == name) else {
            return Err(format!("nothing binds {{{name}}}"));
        };
        out.push_str(value);
        rest = &after[closes + 1..];
    }
}

/// A leading `~`, and only a leading one.
///
/// `~other` is somebody else's home directory, which this app has no business
/// guessing at, and a `~` in the middle of a path is a directory called `~`.
fn expand(value: &str, home: &Path) -> String {
    if value == "~" {
        return home.to_string_lossy().into_owned();
    }
    match value.strip_prefix("~/") {
        // The separators are trimmed because `Path::join` throws the home away
        // when what it is given is absolute: `~//tmp/x` would otherwise expand
        // to `/tmp/x`, a `~` that did not mean home. Nobody could read that
        // off the line they ticked.
        Some(rest) => {
            let rest = rest.trim_start_matches('/');
            if rest.is_empty() {
                home.to_string_lossy().into_owned()
            } else {
                home.join(rest).to_string_lossy().into_owned()
            }
        }
        None => value.to_string(),
    }
}

/// `YYYY-MM-DD`, and nothing that merely starts like one.
fn is_day(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes.iter().enumerate().all(|(at, byte)| at == 4 || at == 7 || byte.is_ascii_digit()) {
        return false;
    }
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

/// `shell.run`'s one method (spec §3.2).
///
/// Everything the frontend worked out arrives in the grant; everything about
/// it is checked again here, because this is the last line before a process
/// exists. A call that does not match what the manifest declared is a strike:
/// the manifest is the plugin's own file, so a mismatch is not a
/// misunderstanding it could have had.
///
/// `params` is `{name, values: {placeholder: value}}`.
pub fn call(app: &AppHandle, plugin: &str, params: &Value) -> Result<Value, String> {
    let wanted = params.get("name").and_then(Value::as_str).unwrap_or("");
    let values = params.get("values").cloned().unwrap_or(Value::Null);

    let Some(command) = app.state::<Registry>().run_of(plugin).into_iter().find(|one| one.name == wanted) else {
        return Err(struck(
            app, plugin,
            format!("{plugin} may not run {wanted}"),
            "asked three times to run something it was not granted",
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

    let home = crate::settings::home_dir().ok_or("this Mac has no home directory")?;
    let args = match bind(&command, &values, &home) {
        Ok(args) => args,
        Err(refusal) => return Err(struck(
            app, plugin,
            format!("{plugin}: {refusal}"),
            "sent a day three times that was not a day",
        )),
    };

    let Some((program, rest)) = args.split_first() else {
        return Err(struck(
            app, plugin,
            format!("{plugin}: {wanted} has nothing to run"),
            "declared a command with nothing in it",
        ));
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
        super::host::put_away(app, plugin, why);
    }
    refusal
}
