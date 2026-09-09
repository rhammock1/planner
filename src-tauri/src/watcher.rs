//! Watching the vault, so an edit made somewhere else shows up here.
//!
//! Split out from the tray because it has nothing to do with the menu bar: it
//! happens to be started when the vault is opened, which is when the tray was
//! being set up anyway.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::vault_io;

/// How often the fallback looks, when the fast way is unavailable (spec §8).
const POLL: Duration = Duration::from_secs(2);

/// How the vault is being watched.
///
/// Reported to the frontend rather than kept quiet, because the three are
/// three different apps to use: one where an edit in `nvim` appears at once,
/// one where it appears within a couple of seconds, and one where it does not
/// appear at all until the page is reopened (spec §8).
#[derive(Serialize, Clone, Copy, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum Watching {
    /// The filesystem tells us. What normally happens.
    Events,
    /// We ask, every couple of seconds.
    Polling,
    /// Neither worked.
    #[default]
    None,
}

/// Kept alive for as long as the vault is open: dropping a watcher stops it.
/// One at a time - opening a second vault should stop watching the first.
#[derive(Default)]
pub struct Watchers(pub Mutex<Watched>);

#[derive(Default)]
pub struct Watched {
    /// Boxed because the fallback is a different type from the fast one, and
    /// which of the two is running is not known until it has been tried.
    held: Option<Box<dyn Watcher + Send>>,
    pub how: Watching,
}

/// Watches the vault and announces every page that changes.
///
/// This is how an edit made in an editor reaches the app. Its own writes are
/// announced when they are made and recognised here as echoes, so a page is
/// re-read once per change however the change arrived (spec §4.1).
///
/// Tries the filesystem's own notifications first and falls back to polling,
/// because a vault on a network share or an unusual filesystem is one where
/// the fast way quietly reports nothing at all.
pub fn watch_vault(app: AppHandle, root: PathBuf) -> Watching {
    let fast = notify::recommended_watcher(changes(app.clone(), root.clone()))
        .map_err(|error| error.to_string())
        .and_then(|watcher| start(watcher, &root));

    let (watcher, how) = match fast {
        Ok(watcher) => (watcher, Watching::Events),
        Err(error) => {
            eprintln!("planner: could not watch {} ({error}); polling instead", root.display());
            let polled = notify::PollWatcher::new(
                changes(app.clone(), root.clone()),
                Config::default().with_poll_interval(POLL),
            )
            .map_err(|error| error.to_string())
            .and_then(|watcher| start(watcher, &root));

            match polled {
                Ok(watcher) => (watcher, Watching::Polling),
                // Nothing is watching. The app still works; it just stops
                // noticing edits made anywhere else (spec §8).
                Err(error) => {
                    eprintln!("planner: could not poll {} either: {error}", root.display());
                    return remember(&app, None, Watching::None);
                }
            }
        }
    };

    remember(&app, Some(watcher), how)
}

/// Starts a watcher on the vault, or gives it back as an error.
///
/// Boxed on the way out so both kinds can be held in the same place.
fn start<W: Watcher + Send + 'static>(
    mut watcher: W,
    root: &Path,
) -> Result<Box<dyn Watcher + Send>, String> {
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    Ok(Box::new(watcher))
}

/// Built fresh for each attempt: a closure that has been handed to one watcher
/// cannot be handed to another.
fn changes(app: AppHandle, root: PathBuf) -> impl Fn(notify::Result<notify::Event>) {
    move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if !event.kind.is_create() && !event.kind.is_modify() && !event.kind.is_remove() {
            return;
        }

        for path in event.paths {
            // What kind of file it is, before it is read. A vault holds the
            // `.tmp` file every atomic write makes and whatever else the
            // person keeps in there; reading each of those to decide it was
            // nothing is work the old code never did and this must not start.
            let page = vault_io::page_for_path(&root, &path);
            let sidecar = match page {
                Some(_) => None,
                None => vault_io::sidecars::sidecar_for_path(&root, &path),
            };
            if page.is_none() && sidecar.is_none() {
                continue;
            }

            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let state = app.state::<crate::vault::SharedVault>();
            let is_echo = state
                .lock()
                .map(|vault| vault.echoes.is_echo(&path, &text))
                .unwrap_or(false);
            if is_echo {
                continue;
            }

            if let Some(page) = page {
                if let Err(error) = app.emit("vault:changed", serde_json::json!({ "page": page })) {
                    eprintln!("planner: could not announce a change to {page}: {error}");
                }
                continue;
            }

            // A file beside a day. Announced under its own name, because
            // nothing that listens for `vault:changed` knows what to do with
            // one and the block that does is not the page (spec §4.1).
            if let Some((date, suffix)) = sidecar {
                let payload = serde_json::json!({ "date": date, "suffix": suffix });
                if let Err(error) = app.emit("sidecar:changed", payload) {
                    eprintln!("planner: could not announce a change to {date}.{suffix}: {error}");
                }
            }
        }
    }
}

/// Keeps the watcher alive and records how it is watching.
fn remember(app: &AppHandle, watcher: Option<Box<dyn Watcher + Send>>, how: Watching) -> Watching {
    match app.try_state::<Watchers>() {
        Some(watchers) => {
            if let Ok(mut held) = watchers.0.lock() {
                held.held = watcher;
                held.how = how;
            }
            how
        }
        // Dropping the watcher here would stop it immediately and silently.
        None => {
            eprintln!("planner: nowhere to keep the watcher; edits made elsewhere will not show");
            Watching::None
        }
    }
}

/// How the open vault is being watched, for a window that arrives after the
/// first one has already opened it.
pub fn watching(app: &AppHandle) -> Watching {
    app.try_state::<Watchers>()
        .and_then(|watchers| watchers.0.lock().ok().map(|held| held.how))
        .unwrap_or(Watching::None)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend switches on these three strings to decide whether to say
    /// anything. Renaming a variant without renaming them there would take
    /// the notice away silently, which is the failure this whole enum exists
    /// to prevent.
    #[test]
    fn the_three_ways_of_watching_read_as_the_page_expects() {
        assert_eq!(serde_json::to_string(&Watching::Events).unwrap(), "\"events\"");
        assert_eq!(serde_json::to_string(&Watching::Polling).unwrap(), "\"polling\"");
        assert_eq!(serde_json::to_string(&Watching::None).unwrap(), "\"none\"");
    }

    /// Nothing watching is the safe thing to assume: it is the one that makes
    /// the page say so.
    #[test]
    fn nothing_is_watching_until_something_is() {
        assert_eq!(Watching::default(), Watching::None);
    }
}
