//! The menu bar item, the popover it opens, and the watcher that keeps the
//! popover honest about what is on disk.

use std::path::PathBuf;
use std::sync::Mutex;

use notify::{RecursiveMode, Watcher};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::vault_io;

const POPOVER: &str = "popover";
const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 560.0;

/// Kept alive for the life of the app: dropping a watcher stops it.
struct Watchers(Mutex<Vec<notify::RecommendedWatcher>>);

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Watchers(Mutex::new(Vec::new())));

    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::with_id("planner");
    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }

    tray
        // A template icon is recoloured by macOS for light, dark and the
        // highlighted menu bar. Anything else would look wrong in one of them.
        .icon_as_template(true)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state, rect, .. } = event {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    toggle_popover(tray.app_handle(), rect.position.to_logical(1.0));
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Opens the popover under the menu bar item, or closes it if it is already
/// open. Clicking the icon a second time putting it away is the behaviour
/// every other menu bar app has, and the one people expect.
fn toggle_popover(app: &AppHandle, at: tauri::LogicalPosition<f64>) {
    if let Some(window) = app.get_webview_window(POPOVER) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position(&window, at);
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    let built = WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::App("index.html".into()))
        .title("Planner")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build();

    match built {
        Ok(window) => {
            position(&window, at);
            let _ = window.show();
            let _ = window.set_focus();
        }
        // Nothing else can report this: there is no window to report it in.
        Err(error) => eprintln!("planner: could not open the popover: {error}"),
    }
}

/// Centres the popover under the icon, nudged down so it clears the menu bar.
fn position(window: &tauri::WebviewWindow, at: tauri::LogicalPosition<f64>) {
    let _ = window.set_position(tauri::LogicalPosition::new(at.x - WIDTH / 2.0 + 11.0, at.y + 6.0));
}

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
                .map(|mut vault| vault.echoes.is_echo(&page, &text))
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
                held.push(watcher);
            }
        }
        // Dropping the watcher here would stop it immediately and silently.
        None => eprintln!("planner: nowhere to keep the watcher; edits made elsewhere will not show"),
    }
}
