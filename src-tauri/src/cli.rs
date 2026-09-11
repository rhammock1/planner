//! What `planner` was asked for, worked out before any window exists.
//!
//! This runs in *every* process that is started, including the one that is
//! about to hand its arguments to an app that is already running and exit.
//! That is the whole reason it is here rather than inside a callback:
//! `tauri-plugin-single-instance` kills the second process from inside
//! Tauri's own setup, and a process that has already handed off has no way to
//! say anything. Parsing first means `--help`, `--version` and every refusal
//! are answered by the process that was actually invoked, with its own
//! stderr and its own exit code, whether or not an app is already up
//! (spec §1.3).
//!
//! The filesystem is touched, but only to ask whether two things exist. No
//! `AppHandle`, no state, nothing that needs a screen - so the whole grammar
//! is tested in `tests/cli.rs` in a few milliseconds.

use std::path::{Path, PathBuf};

/// What the command line asked for.
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Intent {
    /// `planner`, with nothing after it.
    Today,
    /// `planner <path>.md`, resolved and with its folder canonicalized.
    File(PathBuf),
    Help,
    Version,
    /// Said on stderr, with exit code 2.
    Refused(String),
}

pub const USAGE: &str = "\
Planner - a macOS menu bar daily planner

    planner                open today's page
    planner <path>.md      open that file in the window
    planner --help         this
    planner --version      the version

A path may be relative, and a leading ~/ is expanded. The file need not
exist yet; the folder holding it must.";

/// Reads the arguments after the executable's own name.
///
/// `cwd` and `home` are passed in rather than read from the process, so the
/// tests need neither a working directory nor a home directory of their own.
pub fn read(args: &[String], cwd: &Path, home: Option<&Path>) -> Intent {
    // An empty argument is not an argument; and LaunchServices hands a
    // bundled app `-psn_0_…` on some versions of macOS, which is not a path,
    // not an option of ours, and emphatically not a reason to print usage at
    // somebody who double-clicked the icon.
    let mut given = args
        .iter()
        .filter(|one| !one.is_empty() && !one.starts_with("-psn_"));

    let Some(first) = given.next() else { return Intent::Today };
    if given.next().is_some() {
        return Intent::Refused("planner: this takes one path, and nothing else".to_string());
    }

    match first.as_str() {
        "-h" | "--help" => Intent::Help,
        "-V" | "--version" => Intent::Version,
        other if other.starts_with('-') => {
            Intent::Refused(format!("planner: {other} is not an option this app has"))
        }
        other => file(other, cwd, home),
    }
}

/// The four rules in spec §1.2, in order.
fn file(raw: &str, cwd: &Path, home: Option<&Path>) -> Intent {
    let asked = expand(raw, home);
    let joined = if asked.is_absolute() { asked } else { cwd.join(asked) };

    if !crate::files::is_markdown(&joined) {
        return Intent::Refused(format!("planner: {} is not a .md file", joined.display()));
    }
    // Checked before the parent, so a folder called `campaign.md` is named
    // for what it is rather than reported as a file whose folder is fine.
    if joined.is_dir() {
        return Intent::Refused(format!("planner: {} is a folder", joined.display()));
    }

    let (Some(parent), Some(name)) = (joined.parent(), joined.file_name()) else {
        return Intent::Refused(format!("planner: {} does not name a file", joined.display()));
    };

    // The parent, not the path: `canonicalize` fails on a file that is not
    // there yet, and the file need not be. Resolving it anyway is what makes
    // a path reached through a symlink comparable to what the watcher later
    // reports (`vault_io::canonical_root`, for the same reason).
    let Ok(folder) = std::fs::canonicalize(parent) else {
        return Intent::Refused(format!("planner: there is no folder {}", parent.display()));
    };

    Intent::File(folder.join(name))
}

/// A leading `~/` as the shell would have expanded it had it been unquoted.
///
/// The difference between `planner ~/notes.md` and `planner "~/notes.md"` is
/// the shell's business and should not decide whether the command works.
fn expand(raw: &str, home: Option<&Path>) -> PathBuf {
    let Some(home) = home else { return PathBuf::from(raw) };
    if raw == "~" {
        return home.to_path_buf();
    }
    match raw.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(raw),
    }
}
