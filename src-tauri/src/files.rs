//! A file opened by name: not a page, not a file beside a day (spec §2).
//!
//! The vault has always been able to hold one - `page_for_path` matches
//! `someday.md` at the root and `YYYY/MM/YYYY-MM-DD.md` below it, and
//! everything else in the folder is ignored on purpose. This module gives the
//! ignored ones a way in without making them mean anything: nothing here
//! parses, indexes, counts or carries anything forward, and there is no
//! vocabulary in this file for any of those.
//!
//! Unlike a page or a sidecar, such a file may live anywhere. You typed the
//! path in your own terminal, and the allowlist this app does have exists to
//! constrain plugins rather than the person whose notes these are (the same
//! argument `open_link` already makes). The `.md` rule is not that kind of
//! list: the view renders Markdown, so a path that is not Markdown would be
//! drawn as something other than what the file says.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::vault::SharedVault;
use crate::vault_io;

/// The file a window has open, so the watcher knows which loose path is worth
/// reading (spec §2.5).
///
/// One slot, because one window opens files and it shows one at a time. Held
/// even when the file is not on disk yet: a file that does not exist is still
/// the file this window is showing, and the moment somebody creates it is
/// exactly when the window wants to hear about it.
#[derive(Default)]
pub struct Opened(Mutex<Option<PathBuf>>);

impl Opened {
    /// The path a window has open, for the watcher to compare against.
    pub fn held(app: &AppHandle) -> Option<PathBuf> {
        app.try_state::<Opened>()
            .and_then(|opened| opened.0.lock().ok().and_then(|held| held.clone()))
    }

    fn set(app: &AppHandle, path: Option<PathBuf>) {
        let Some(opened) = app.try_state::<Opened>() else {
            eprintln!("planner: nowhere to remember the open file; it will not follow edits");
            return;
        };
        // A named binding rather than `if let`, so the guard is a local
        // declared after `opened` and therefore dropped before it. The `if
        // let` form leaves a temporary that outlives the state it borrows.
        let Ok(mut held) = opened.0.lock() else { return };
        *held = path;
    }
}

/// Whether this app will open the file at all.
///
/// Shared with `cli.rs`, which refuses the same paths before a window exists.
/// One rule, one place: the command line and the command must agree, or a
/// path refused at the door arrives through the window.
pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

/// What a file says, or `None` for one that is not there - which is how the
/// window tells "new file" from "empty file".
pub fn read(path: &Path) -> Option<String> {
    if !is_markdown(path) {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Writes a file atomically, the same way a page and a sidecar are written: a
/// temporary file in the same folder, flushed, then renamed over the target.
/// The promise in spec §8 is about the vault, not about which of the kinds of
/// file is in it.
pub fn write(path: &Path, text: &str) -> Result<(), String> {
    if !is_markdown(path) {
        return Err(format!("{} is not a .md file", path.display()));
    }
    vault_io::write_atomic(path, text).map_err(|error| error.to_string())
}

/// Reads a file, and remembers that this is the one a window is showing.
#[tauri::command]
pub fn read_file(app: AppHandle, path: String) -> Option<String> {
    let path = PathBuf::from(path);
    Opened::set(&app, Some(path.clone()));
    read(&path)
}

/// Writes a file and announces it.
///
/// Announced here rather than left to the watcher so the app's own edits
/// appear at once instead of after a filesystem round trip - and recorded as
/// an echo first, so the watcher recognises the write moments later and does
/// not announce it a second time. Exactly what `write_page` and
/// `write_sidecar` do, for exactly the same reasons.
#[tauri::command]
pub fn write_file(
    app: AppHandle,
    vault: State<'_, SharedVault>,
    path: String,
    text: String,
) -> Result<(), String> {
    let path = PathBuf::from(path);

    // Recorded whether or not the file is in the vault. Outside it there is
    // no watcher to fool, and the record costs a hash.
    if let Ok(mut state) = vault.lock() {
        state.echoes.record(&path, &text);
    }

    write(&path, &text).map_err(|error| {
        eprintln!("planner: could not write {}: {error}", path.display());
        error
    })?;

    let payload = serde_json::json!({ "path": path.to_string_lossy() });
    if let Err(error) = app.emit("file:changed", payload) {
        eprintln!("planner: wrote {} but could not announce it: {error}", path.display());
    }
    Ok(())
}

/// The window saying it is no longer showing a file.
#[tauri::command]
pub fn close_file(app: AppHandle) {
    Opened::set(&app, None);
}
