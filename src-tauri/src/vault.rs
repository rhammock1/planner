//! The vault this app has open, and everything a window may ask of it.
//!
//! The other half of `vault_io.rs`, and the halves divide on who is asking.
//! `vault_io` is the disk: where a page lives, what counts as one, and the
//! promise that a write either lands whole or changes nothing. This is the
//! shell around it - the root the frontend chose, the echoes that let the
//! watcher recognise our own writes, and the commands a window calls.
//!
//! Rust does not parse `config.toml`: there is one TOML reader in this
//! project and it is in JavaScript, where the settings pane already needs it.
//! The frontend reads the config, resolves the path, and passes it here.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::vault_io::{self, Echoes, PageFile};
use crate::watcher;

/// Where the vault is, once the frontend has read the config and said so.
///
/// Rust does not parse `config.toml`: there is one TOML reader in this project
/// and it is in JavaScript, where the settings pane already needs it. The
/// frontend reads the config, resolves the path, and passes it here.
#[derive(Default)]
pub(crate) struct Vault {
    root: Option<PathBuf>,
    pub(crate) echoes: Echoes,
}

pub(crate) type SharedVault = Mutex<Vault>;

/// The open vault's root, for a bridge that has an `AppHandle` and no `State`
/// argument of its own.
pub(crate) fn root(app: &AppHandle) -> Option<PathBuf> {
    app.state::<SharedVault>().lock().expect("vault lock").root.clone()
}

#[derive(Serialize)]
pub(crate) struct VaultStatus {
    /// False when the folder is not there; the frontend says so rather than
    /// creating a vault somewhere the user did not ask for (spec §8).
    exists: bool,
    /// Whether edits made elsewhere will show up, and how quickly. The page
    /// says so when it is not the fast way.
    watching: watcher::Watching,
}

/// Opens a vault, once.
///
/// Every window asks for this as it starts, so quick add opening for the first
/// time asks a second time for the vault that is already open. Watching it
/// twice would put two watchers on the same folder, and because an echo is
/// recognised only once, the second would report the app's own writes as
/// somebody else's edits.
#[tauri::command]
pub fn set_vault(app: AppHandle, vault: State<'_, SharedVault>, path: String) -> VaultStatus {
    let root = vault_io::canonical_root(&PathBuf::from(path));
    let exists = root.is_dir();

    let opened = {
        let mut state = vault.lock().expect("vault lock");
        let same = state.root.as_deref() == Some(root.as_path());
        state.root = Some(root.clone());
        !same
    };
    if !opened {
        // Already open, and already being watched however it is being
        // watched. This window should say the same thing the first one did.
        return VaultStatus { exists, watching: watcher::watching(&app) };
    }

    eprintln!(
        "planner: vault {} ({})",
        root.display(),
        if exists { "found" } else { "not found" }
    );

    let watching = if exists {
        watcher::watch_vault(app, root)
    } else {
        watcher::Watching::None
    };
    VaultStatus { exists, watching }
}

#[tauri::command]
pub fn read_vault(vault: State<'_, SharedVault>) -> Vec<PageFile> {
    let root = vault.lock().expect("vault lock").root.clone();
    root.map(|root| vault_io::read_all(&root)).unwrap_or_default()
}

/// Where a page's file is, for handing to an editor. Not for reading with -
/// that is `read_page`; this exists so the escape hatch in §8 can name the
/// file it is opening.
#[tauri::command]
pub fn page_path(vault: State<'_, SharedVault>, page: String) -> Option<String> {
    let root = vault.lock().expect("vault lock").root.clone()?;
    Some(vault_io::path_for_page(&root, &page).to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_page(vault: State<'_, SharedVault>, page: String) -> Option<String> {
    let root = vault.lock().expect("vault lock").root.clone()?;
    vault_io::read_page(&root, &page)
}

/// Writes a page and announces it.
///
/// The event is emitted here rather than left to the watcher so that the app's
/// own edits appear at once instead of after a filesystem round trip. The
/// watcher will see the same write moments later and recognise it as an echo
/// of this one, so the page is re-read once, not twice.
#[tauri::command]
pub fn write_page(
    app: AppHandle,
    vault: State<'_, SharedVault>,
    page: String,
    text: String,
) -> Result<(), String> {
    let root = {
        let mut state = vault.lock().expect("vault lock");
        let root = state.root.clone().ok_or("no vault is open")?;
        state.echoes.record(&vault_io::path_for_page(&root, &page), &text);
        root
    };

    vault_io::write_page(&root, &page, &text).map_err(|error| {
        eprintln!("planner: could not write {page}: {error}");
        error.to_string()
    })?;

    if let Err(error) = app.emit("vault:changed", serde_json::json!({ "page": page })) {
        // The file is written but nothing knows: the page on screen would sit
        // there showing the old text with no way to find out. Say so.
        eprintln!("planner: wrote {page} but could not announce it: {error}");
    }
    Ok(())
}

/// A file beside a day, or `None` when it is not there - which is how a block
/// tells "no note yet" from "an empty note".
#[tauri::command]
pub fn read_sidecar(vault: State<'_, SharedVault>, date: String, suffix: String) -> Option<String> {
    let root = vault.lock().expect("vault lock").root.clone()?;
    vault_io::sidecars::read(&root, &date, &suffix)
}

/// Every sidecar between two dates. The app's own windows only - a plugin
/// reaches the same files through `vault.sidecar.read`, scoped to the
/// prefixes it owns.
#[tauri::command]
pub fn list_sidecars(
    vault: State<'_, SharedVault>,
    from: String,
    to: String,
) -> Vec<vault_io::sidecars::Sidecar> {
    let root = vault.lock().expect("vault lock").root.clone();
    root.map(|root| vault_io::sidecars::list(&root, &from, &to)).unwrap_or_default()
}

/// Writes a sidecar and announces it, exactly as `write_page` does for a day.
///
/// The app holds the pen: a plugin names a sidecar and never writes one
/// (spec §4.1), so this is reachable only from the app's own windows.
#[tauri::command]
pub fn write_sidecar(
    app: AppHandle,
    vault: State<'_, SharedVault>,
    date: String,
    suffix: String,
    text: String,
) -> Result<(), String> {
    let root = {
        let mut state = vault.lock().expect("vault lock");
        let root = state.root.clone().ok_or("no vault is open")?;
        let path = vault_io::sidecars::sidecar_path(&root, &date, &suffix)
            .ok_or_else(|| format!("{date}.{suffix} is not a sidecar's name"))?;
        state.echoes.record(&path, &text);
        root
    };

    vault_io::sidecars::write(&root, &date, &suffix, &text).map_err(|error| {
        eprintln!("planner: could not write {date}.{suffix}: {error}");
        error.to_string()
    })?;

    let payload = serde_json::json!({ "date": date, "suffix": suffix });
    if let Err(error) = app.emit("sidecar:changed", payload) {
        eprintln!("planner: wrote {date}.{suffix} but could not announce it: {error}");
    }
    Ok(())
}

/// Deletes a sidecar by moving it aside (spec §2.4).
///
/// The app's own gesture: no plugin declares it, no capability grants it, and
/// it is reachable only from the app's own windows. An accidentally created
/// note is the app's problem rather than a plugin's.
#[tauri::command]
pub fn delete_sidecar(
    app: AppHandle,
    vault: State<'_, SharedVault>,
    date: String,
    suffix: String,
) -> Result<(), String> {
    let root = {
        let mut state = vault.lock().expect("vault lock");
        let root = state.root.clone().ok_or("no vault is open")?;
        let path = vault_io::sidecars::sidecar_path(&root, &date, &suffix)
            .ok_or_else(|| format!("{date}.{suffix} is not a sidecar's name"))?;
        // Recorded against empty content: a remove event reads the now-gone
        // file back as "" (see `changes` in `watcher.rs`), so this is the
        // echo that makes the watcher recognise its own move and not also
        // announce it - the same reason `write_sidecar` records one before it
        // writes.
        state.echoes.record(&path, "");
        root
    };

    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();

    vault_io::sidecars::trash(&root, &date, &suffix, at).map_err(|error| {
        eprintln!("planner: could not delete {date}.{suffix}: {error}");
        error.to_string()
    })?;

    let payload = serde_json::json!({ "date": date, "suffix": suffix });
    if let Err(error) = app.emit("sidecar:changed", payload) {
        eprintln!("planner: deleted {date}.{suffix} but could not announce it: {error}");
    }
    Ok(())
}
