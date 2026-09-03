//! The shell: a menu bar item, a popover, and the file access the frontend
//! cannot do for itself.
//!
//! Everything this file exposes is either a window or a file operation. No
//! decision about what a planner page means is made here - that lives in
//! `src/core/`, in JavaScript, where it can be tested in half a second
//! without a Rust toolchain (spec §4.2).

/// Public so the tests in `tests/` can reach the day arithmetic; nothing
/// outside this crate has any business calling a bridge.
pub mod bridges;
mod notify;
mod quick_add;
mod settings;
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
struct VaultStatus {
    /// False when the folder is not there; the frontend says so rather than
    /// creating a vault somewhere the user did not ask for (spec §8).
    exists: bool,
    /// Whether edits made elsewhere will show up, and how quickly. The page
    /// says so when it is not the fast way.
    watching: watcher::Watching,
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
fn read_vault(vault: State<'_, SharedVault>) -> Vec<PageFile> {
    let root = vault.lock().expect("vault lock").root.clone();
    root.map(|root| vault_io::read_all(&root)).unwrap_or_default()
}

/// Where a page's file is, for handing to an editor. Not for reading with -
/// that is `read_page`; this exists so the escape hatch in §8 can name the
/// file it is opening.
#[tauri::command]
fn page_path(vault: State<'_, SharedVault>, page: String) -> Option<String> {
    let root = vault.lock().expect("vault lock").root.clone()?;
    Some(vault_io::path_for_page(&root, &page).to_string_lossy().into_owned())
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
        settings::read_config,
        settings::write_config,
        settings::read_theme,
        settings::choose_vault,
        settings::open_in_editor,
        set_hotkey,
        close_quick_add,
        set_vault,
        read_vault,
        read_page,
        page_path,
        write_page,
        tray::set_pinned,
        tray::set_badge,
        notify::set_notifications,
        tray::close_popover,
        spread::open_spread,
        spread::spread_view,
        plugins::door::plugin_message,
        plugins::list_plugins,
        plugins::start_plugin,
        plugins::contribute
    ]);

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SharedVault::default())
        .manage(notify::Alarms::default())
        .manage(plugins::Registry::default())
        .manage(plugins::door::InFlight::default())
        .manage(plugins::waiting::Pending::default())
        .manage(plugins::waiting::Started::default())
        // Every plugin's page and code is served from here, out of its own
        // folder and nowhere else (see `plugins::host::respond`).
        .register_uri_scheme_protocol("plugin", |context, request| {
            plugins::serving::respond(context.app_handle(), &request)
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
            // The one thread that holds real timers, because a hidden
            // webview's are throttled (spec §5.9).
            notify::hold(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("planner failed to start");
}
