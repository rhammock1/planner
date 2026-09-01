//! The shell: a menu bar item, a popover, and the file access the frontend
//! cannot do for itself.
//!
//! Everything this file exposes is either a window or a file operation. No
//! decision about what a planner page means is made here - that lives in
//! `src/core/`, in JavaScript, where it can be tested in half a second
//! without a Rust toolchain (spec §4.2).

mod bridges;
mod quick_add;
mod spread;
mod tray;
mod watcher;

/// Public so the tests in `tests/` can reach it.
pub mod plugins;

/// Public so the tests in `tests/` can reach it.
pub mod popover;

/// Public so the tests in `tests/` can reach it.
pub mod shortcut;

/// Public so the tests in `tests/` can reach it; nothing outside this crate
/// has any business calling it.
pub mod vault_io;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use vault_io::{Echoes, PageFile};

/// Where the vault is, once the frontend has read the config and said so.
///
/// Rust does not parse `config.toml`: there is one TOML reader in this project
/// and it is in JavaScript, where the settings pane already needs it. The
/// frontend reads the config, resolves the path, and passes it here.
#[derive(Default)]
struct Vault {
    root: Option<PathBuf>,
    echoes: Echoes,
}

type SharedVault = Mutex<Vault>;

#[derive(Serialize)]
struct ConfigFile {
    text: String,
    /// Sent along so the frontend can resolve a `~` in the vault path with the
    /// same tested function the settings pane uses, rather than Rust growing a
    /// second opinion about what `~/Planner` means.
    home: String,
}

#[derive(Serialize)]
struct ThemeFiles {
    toml: String,
    css: String,
}

#[derive(Serialize)]
struct VaultStatus {
    /// False when the folder is not there; the frontend says so rather than
    /// creating a vault somewhere the user did not ask for (spec §8).
    exists: bool,
}

#[tauri::command]
fn read_config() -> ConfigFile {
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

/// The shortcut that opens quick add, from `config.toml`.
#[tauri::command]
fn set_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    // Said out loud once per launch, because a shortcut that failed to
    // register looks exactly like one that works until you press it.
    match quick_add::set_shortcut(&app, &accelerator) {
        Ok(()) => {
            eprintln!("planner: {} opens quick add", shortcut::symbols(&accelerator));
            Ok(())
        }
        Err(error) => {
            eprintln!("planner: {error}");
            Err(error)
        }
    }
}

/// Called by the quick-add window when it is finished with, or dismissed.
#[tauri::command]
fn close_quick_add(app: AppHandle) {
    quick_add::hide(&app);
}

#[tauri::command]
fn read_theme(app: AppHandle, name: String) -> ThemeFiles {
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

/// Opens a vault, once.
///
/// Every window asks for this as it starts, so quick add opening for the first
/// time asks a second time for the vault that is already open. Watching it
/// twice would put two watchers on the same folder, and because an echo is
/// recognised only once, the second would report the app's own writes as
/// somebody else's edits.
#[tauri::command]
fn set_vault(app: AppHandle, vault: State<'_, SharedVault>, path: String) -> VaultStatus {
    let root = vault_io::canonical_root(&PathBuf::from(path));
    let exists = root.is_dir();

    let opened = {
        let mut state = vault.lock().expect("vault lock");
        let same = state.root.as_deref() == Some(root.as_path());
        state.root = Some(root.clone());
        !same
    };
    if !opened {
        return VaultStatus { exists };
    }

    eprintln!(
        "planner: vault {} ({})",
        root.display(),
        if exists { "found" } else { "not found" }
    );

    if exists {
        watcher::watch_vault(app, root);
    }
    VaultStatus { exists }
}

#[tauri::command]
fn read_vault(vault: State<'_, SharedVault>) -> Vec<PageFile> {
    let root = vault.lock().expect("vault lock").root.clone();
    root.map(|root| vault_io::read_all(&root)).unwrap_or_default()
}

#[tauri::command]
fn read_page(vault: State<'_, SharedVault>, page: String) -> Option<String> {
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
fn write_page(
    app: AppHandle,
    vault: State<'_, SharedVault>,
    page: String,
    text: String,
) -> Result<(), String> {
    let root = {
        let mut state = vault.lock().expect("vault lock");
        state.echoes.record(&page, &text);
        state.root.clone().ok_or("no vault is open")?
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Every invoke passes the gate before it reaches a command. A plugin
    // window may call one of them; the app's own windows may call any (see
    // `plugins::allowed`).
    type Commands = Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync>;
    let commands: Commands = Box::new(tauri::generate_handler![
        read_config,
        set_hotkey,
        close_quick_add,
        read_theme,
        set_vault,
        read_vault,
        read_page,
        write_page,
        tray::set_pinned,
        tray::close_popover,
        spread::open_spread,
        spread::spread_view,
        plugins::plugin_message,
        plugins::list_plugins,
        plugins::start_plugin,
        plugins::contribute
    ]);

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(SharedVault::default())
        .manage(plugins::Registry::default())
        .manage(plugins::waiting::Pending::default())
        .manage(plugins::waiting::Started::default())
        // Every plugin's page and code is served from here, out of its own
        // folder and nowhere else (see `plugins::host::respond`).
        .register_uri_scheme_protocol("plugin", |context, request| {
            plugins::host::respond(context.app_handle(), &request)
        })
        .invoke_handler(move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
            let label = invoke.message.webview_ref().label();
            let command = invoke.message.command();
            if plugins::allowed(label, command) {
                return commands(invoke);
            }
            // Said out loud. A plugin reaching for a command it cannot have is
            // either broken or trying it on, and both are worth seeing.
            eprintln!("planner: refused {command} from {label}");
            let refusal = format!("{command} is not available to a plugin");
            invoke.resolver.reject(refusal);
            true
        })
        .setup(|app| {
            // No dock icon and no menu bar of its own: the app is the item in
            // the menu bar, and nothing else (spec §1).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.manage(spread::View::default());
            tray::install(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("planner failed to start");
}

/// Where config and installed themes live: `~/.planner`, unless
/// `PLANNER_HOME` says otherwise.
///
/// The override exists so the app can be run against a throwaway config
/// without writing anything into a real home directory - which is how it gets
/// tested, and how two vaults can be looked at side by side.
pub(crate) fn planner_dir() -> Option<PathBuf> {
    if let Some(overridden) = std::env::var_os("PLANNER_HOME") {
        return Some(PathBuf::from(overridden));
    }
    dirs::home_dir().map(|home| home.join(".planner"))
}
