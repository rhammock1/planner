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

/// What a changed path is, decided before it is read.
///
/// A vault holds the `.tmp` file every atomic write makes and whatever else
/// the person keeps in there. Reading each of those to decide it was nothing
/// is work this app has never done, so the kind is settled from the path
/// alone - which also makes the rule testable without a filesystem, a
/// watcher, or a screen.
#[derive(Debug, PartialEq, Eq)]
pub enum Change {
    Page(String),
    Sidecar(String, String),
    /// The one loose file a window has open (spec §2.5).
    File,
    Nothing,
}

/// The kind of a changed path.
///
/// `opened` is the file a window is showing, or `None`. A loose Markdown file
/// that nobody is looking at is `Nothing`: this app will not read every file
/// in the vault because one of them changed, and the registry names one file
/// rather than a category.
pub fn classify(root: &Path, path: &Path, opened: Option<&Path>) -> Change {
    if let Some(page) = vault_io::page_for_path(root, path) {
        return Change::Page(page);
    }
    if let Some((date, suffix)) = vault_io::sidecars::sidecar_for_path(root, path) {
        return Change::Sidecar(date, suffix);
    }
    if opened == Some(path) {
        return Change::File;
    }
    Change::Nothing
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
            // What kind of file it is, before it is read. See `classify`.
            let opened = crate::files::Opened::held(&app);
            let change = classify(&root, &path, opened.as_deref());
            if change == Change::Nothing {
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

            let announced = match &change {
                Change::Page(page) => {
                    app.emit("vault:changed", serde_json::json!({ "page": page }))
                }
                // A file beside a day. Announced under its own name, because
                // nothing that listens for `vault:changed` knows what to do
                // with one and the block that does is not the page (spec §4.1).
                Change::Sidecar(date, suffix) => {
                    app.emit("sidecar:changed", serde_json::json!({ "date": date, "suffix": suffix }))
                }
                // A file of somebody's own, open in the window. Its own name
                // again, for the same reason: it is not a page, it is not
                // beside a day, and the only thing that knows what to do with
                // it is the window showing it (spec §2.5).
                Change::File => {
                    app.emit("file:changed", serde_json::json!({ "path": path.to_string_lossy() }))
                }
                Change::Nothing => Ok(()),
            };

            if let Err(error) = announced {
                eprintln!("planner: could not announce a change to {}: {error}", path.display());
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

    use std::path::PathBuf;

    fn root() -> PathBuf {
        PathBuf::from("/Users/x/Planner")
    }

    #[test]
    fn a_day_file_is_the_page_it_names() {
        assert_eq!(
            classify(&root(), &root().join("2026/09/2026-09-01.md"), None),
            Change::Page("2026-09-01".to_string()),
        );
    }

    #[test]
    fn a_file_beside_a_day_is_a_sidecar() {
        assert_eq!(
            classify(&root(), &root().join("2026/09/2026-09-01.meeting-standup.md"), None),
            Change::Sidecar("2026-09-01".to_string(), "meeting-standup".to_string()),
        );
    }

    /// The property this whole function exists to keep: a vault holds the
    /// `.tmp` file every atomic write makes, and whatever else the person
    /// keeps in there. Reading each of those to decide it was nothing is work
    /// this app has never done and must not start.
    #[test]
    fn a_loose_file_nobody_is_looking_at_is_nothing() {
        assert_eq!(classify(&root(), &root().join("A-RUMBLING-OF-THUNDER.md"), None), Change::Nothing);
        assert_eq!(classify(&root(), &root().join(".campaign.md.tmp"), None), Change::Nothing);
    }

    #[test]
    fn the_one_loose_file_a_window_has_open_is_worth_announcing() {
        let open = root().join("A-RUMBLING-OF-THUNDER.md");
        assert_eq!(classify(&root(), &open, Some(&open)), Change::File);
    }

    /// A second loose file changing while a different one is open is still
    /// nothing: the registry names one file, not a category.
    #[test]
    fn a_different_loose_file_is_still_nothing() {
        let open = root().join("A-RUMBLING-OF-THUNDER.md");
        assert_eq!(classify(&root(), &root().join("bestiary.md"), Some(&open)), Change::Nothing);
    }

    /// A day file stays a day file even when it is the one a window has open,
    /// so the page on screen still hears about it as a page.
    #[test]
    fn a_page_is_a_page_even_when_it_is_the_open_file() {
        let day = root().join("2026/09/2026-09-01.md");
        assert_eq!(classify(&root(), &day, Some(&day)), Change::Page("2026-09-01".to_string()));
    }

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
