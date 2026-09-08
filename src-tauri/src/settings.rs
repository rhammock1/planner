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

/// Where `~` points.
///
/// The real one, not `PLANNER_HOME`: that variable moves where this app keeps
/// its own files, and a `~` a person typed into a settings row still means
/// their home directory. It is the same one `read_config` already hands the
/// frontend, so the two sides expand a path the same way (spec §3.2).
pub fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

/// Opens a vault page in whatever editor the user actually uses (spec §8).
///
/// The escape hatch. Everything this app does to a file it does through one
/// parser, and a parser is a thing that can be wrong about a line; the way out
/// of that has always been to open the file, which is why it is a folder of
/// Markdown in the first place (spec §1).
///
/// Run through a login shell, so `editor` can be a command with arguments and
/// so it is found on the PATH a terminal would give it. A terminal editor
/// needs a terminal, which this is not: point `editor` at a script that opens
/// one (see README).
#[tauri::command]
pub fn open_in_editor(path: String, editor: String) -> Result<(), String> {
    let line = command_line(&path, &editor);

    std::process::Command::new("sh")
        .arg("-lc")
        .arg(&line)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            eprintln!("planner: could not run {line}: {error}");
            format!("could not run {line}: {error}")
        })
}

/// The line handed to `sh`.
///
/// The path is single-quoted, and any apostrophe in it closes the quoting and
/// reopens it - a vault in a folder called `Rob's Notes` is otherwise a syntax
/// error, and worse, a command that runs with the wrong argument.
fn command_line(path: &str, editor: &str) -> String {
    format!("{} '{}'", chosen_editor(editor), path.replace('\'', "'\\''"))
}

/// `editor` from the config, then `$VISUAL`, then `$EDITOR`, then whatever
/// macOS opens a `.md` with (spec §3.6).
///
/// The last one is the only link in the chain that is certain to work without
/// being set up, which is why it is there: an escape hatch that needs
/// configuring before it opens is not an escape hatch.
fn chosen_editor(configured: &str) -> String {
    for candidate in [configured.to_string(), env("VISUAL"), env("EDITOR")] {
        if !candidate.trim().is_empty() {
            return candidate;
        }
    }
    "open".to_string()
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::chosen_editor;

    #[test]
    fn the_configured_editor_wins() {
        assert_eq!(chosen_editor("mate -w"), "mate -w");
    }

    /// Without one, something always opens. An escape hatch that has to be
    /// configured before it opens is not an escape hatch.
    #[test]
    fn without_one_the_system_default_opens_the_file() {
        // $VISUAL and $EDITOR are not set under `cargo test`; if a machine has
        // them, this is the one case that cannot be asserted here.
        if !super::env("VISUAL").is_empty() || !super::env("EDITOR").is_empty() {
            return;
        }
        assert_eq!(chosen_editor(""), "open");
    }

    #[test]
    fn an_apostrophe_in_the_path_does_not_break_out_of_the_quoting() {
        let line = super::command_line("/Users/rob/Rob's Notes/2026-09-01.md", "mate");
        assert_eq!(line, "mate '/Users/rob/Rob'\\''s Notes/2026-09-01.md'");
    }

    #[test]
    fn an_ordinary_path_is_quoted_once() {
        assert_eq!(super::command_line("/tmp/a b.md", "mate"), "mate '/tmp/a b.md'");
    }

    #[test]
    fn whitespace_is_not_a_setting() {
        if !super::env("VISUAL").is_empty() || !super::env("EDITOR").is_empty() {
            return;
        }
        assert_eq!(chosen_editor("   "), "open");
    }
}
