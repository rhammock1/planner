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

/// Public so `main.rs` can answer the command line before Tauri starts, and
/// so the tests in `tests/` can read the grammar without one.
pub mod cli;
mod links;
mod notify;
mod quick_add;
mod settings;
mod spread;
mod tray;
mod vault;
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

use tauri::{AppHandle, Manager};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(intent: cli::Intent) {
    // Acted on in the next commit, when there is a window to act on it with.
    let _ = &intent;

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
        vault::set_vault,
        vault::read_vault,
        vault::read_page,
        vault::page_path,
        vault::write_page,
        vault::read_sidecar,
        vault::list_sidecars,
        vault::write_sidecar,
        vault::delete_sidecar,
        tray::set_pinned,
        tray::set_badge,
        notify::set_notifications,
        tray::close_popover,
        spread::open_spread,
        spread::spread_view,
        plugins::door::plugin_message,
        plugins::list_plugins,
        plugins::start_plugin,
        plugins::stop_plugin,
        plugins::ask_plugins,
        plugins::plugin_states,
        plugins::opening::open_url,
        links::open_link
    ]);

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(vault::SharedVault::default())
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

            // Off the launch thread and then forgotten about: this runs a
            // login shell, and a profile that starts an agent or asks a
            // question takes its whole five seconds. Doing it here rather than
            // on the first `shell.run` means that wait is over before any
            // plugin asks; doing it on a thread means a slow profile costs the
            // launch nothing (spec §3.2).
            std::thread::spawn(|| {
                let _ = plugins::spawning::login_path();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("planner failed to start");
}
