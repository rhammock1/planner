//! Watching the vault, so an edit made somewhere else shows up here.
//!
//! Split out from the tray because it has nothing to do with the menu bar: it
//! happens to be started when the vault is opened, which is when the tray was
//! being set up anyway.

use std::path::PathBuf;
use std::sync::Mutex;

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::vault_io;

/// Kept alive for as long as the vault is open: dropping a watcher stops it.
/// One at a time - opening a second vault should stop watching the first.
#[derive(Default)]
pub struct Watchers(pub Mutex<Option<notify::RecommendedWatcher>>);

/// Watches the vault and announces every page that changes.
///
/// This is how an edit made in an editor reaches the app. Its own writes are
/// announced when they are made and recognised here as echoes, so a page is
/// re-read once per change however the change arrived (spec §4.1).
pub fn watch_vault(app: AppHandle, root: PathBuf) {
    let handle = app.clone();
    let watched = root.clone();

    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if !event.kind.is_create() && !event.kind.is_modify() && !event.kind.is_remove() {
            return;
        }

        for path in event.paths {
            let Some(page) = vault_io::page_for_path(&watched, &path) else { continue };

            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let state = handle.state::<crate::SharedVault>();
            let is_echo = state
                .lock()
                .map(|vault| vault.echoes.is_echo(&page, &text))
                .unwrap_or(false);

            if !is_echo {
                if let Err(error) = handle.emit("vault:changed", serde_json::json!({ "page": page })) {
                    eprintln!("planner: could not announce a change to {page}: {error}");
                }
            }
        }
    });

    // A vault nobody is watching still works - it just stops noticing edits
    // made elsewhere, which is worth saying out loud (spec §8).
    let mut watcher = match watcher {
        Ok(watcher) => watcher,
        Err(error) => {
            eprintln!("planner: could not start the file watcher: {error}");
            return;
        }
    };

    if let Err(error) = watcher.watch(&root, RecursiveMode::Recursive) {
        eprintln!("planner: could not watch {}: {error}", root.display());
        return;
    }

    match app.try_state::<Watchers>() {
        Some(watchers) => {
            if let Ok(mut held) = watchers.0.lock() {
                held.replace(watcher);
            }
        }
        // Dropping the watcher here would stop it immediately and silently.
        None => eprintln!("planner: nowhere to keep the watcher; edits made elsewhere will not show"),
    }
}
