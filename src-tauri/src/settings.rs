//! `~/.planner` - the config file and the installed themes.
//!
//! Rust does not parse any of it. There is one TOML reader in this project and
//! it is in JavaScript, where the settings pane already needs it (spec §4.2).
//! What is here is the file access the frontend cannot do for itself: read a
//! file, write a file, and know where to look.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub struct ConfigFile {
    pub text: String,
    /// Sent along so the frontend can resolve a `~` in the vault path with the
    /// same tested function the settings pane uses, rather than Rust growing a
    /// second opinion about what `~/Planner` means.
    pub home: String,
}

#[derive(Serialize)]
pub struct ThemeFiles {
    pub toml: String,
    pub css: String,
}

#[tauri::command]
pub fn read_config() -> ConfigFile {
    ConfigFile {
        text: planner_dir()
            .map(|dir| dir.join("config.toml"))
            .and_then(|path| std::fs::read_to_string(path).ok())
            .unwrap_or_default(),
        home: dirs::home_dir()
            .map(|home| home.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

/// Writes `config.toml`, creating `~/.planner` if this is the first time.
///
/// The text arrives whole, already edited by `core/tomlEdit.js` - which is
/// what keeps comments, alignment and keys this version does not know about
/// (spec §3.6). Rust is not deciding anything here; it is holding the pen.
#[tauri::command]
pub fn write_config(text: String) -> Result<(), String> {
    let dir = planner_dir().ok_or("there is no home directory to write settings into")?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;

    let path = dir.join("config.toml");
    // Not atomic, unlike a vault page: this file is not the user's writing,
    // and losing a half-written settings file costs a re-pick, not a day.
    std::fs::write(&path, text).map_err(|error| {
        eprintln!("planner: could not write {}: {error}", path.display());
        format!("{}: {error}", path.display())
    })
}

#[tauri::command]
pub fn read_theme(app: AppHandle, name: String) -> ThemeFiles {
    // The user's own themes win over the bundled ones, so a copy of Ledger in
    // ~/.planner/themes can be edited without touching the app.
    let installed = planner_dir().map(|dir| dir.join("themes").join(&name));
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("themes").join(&name));

    for folder in [installed, bundled].into_iter().flatten() {
        let toml = std::fs::read_to_string(folder.join("theme.toml")).unwrap_or_default();
        if !toml.is_empty() {
            return ThemeFiles {
                toml,
                css: std::fs::read_to_string(folder.join("theme.css")).unwrap_or_default(),
            };
        }
    }

    ThemeFiles { toml: String::new(), css: String::new() }
}

/// Asks for a folder to keep the vault in (spec §8).
///
/// The app never creates one itself. A planner that quietly made
/// `~/Documents/Planner` on first run would be a folder you find months later
/// and cannot account for; being asked once is cheaper than that.
///
/// Blocking, on a thread of its own: the dialog runs its own event loop, and
/// running it on the main one would stop everything else the app is doing.
#[tauri::command]
pub async fn choose_vault(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Where should the planner keep its pages?")
            .blocking_pick_folder()
            .and_then(|picked| picked.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())
}

/// Where config and installed themes live: `~/.planner`, unless
/// `PLANNER_HOME` says otherwise.
///
/// The override exists so the app can be run against a throwaway config
/// without writing anything into a real home directory - which is how it gets
/// tested, and how two vaults can be looked at side by side.
pub fn planner_dir() -> Option<PathBuf> {
    if let Some(overridden) = std::env::var_os("PLANNER_HOME") {
        return Some(PathBuf::from(overridden));
    }
    dirs::home_dir().map(|home| home.join(".planner"))
}
