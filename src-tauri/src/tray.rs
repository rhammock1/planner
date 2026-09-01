//! The menu bar item, the popover it opens, and the watcher that keeps the
//! popover honest about what is on disk.

use std::path::PathBuf;
use std::sync::Mutex;

use notify::{RecursiveMode, Watcher};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::popover::{self, Bounds};
use crate::vault_io;

const POPOVER: &str = "popover";
const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 560.0;

/// Kept alive for the life of the app: dropping a watcher stops it.
struct Watchers(Mutex<Vec<notify::RecommendedWatcher>>);

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Watchers(Mutex::new(Vec::new())));
    create_popover(app);

    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::with_id("planner");
    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }

    tray
        // A template icon is recoloured by macOS for light, dark and the
        // highlighted menu bar. Anything else would look wrong in one of them.
        .icon_as_template(true)
        // Hovering an icon that says nothing about itself leaves you guessing
        // which app it belongs to.
        .tooltip("Planner")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state, rect, .. } = event {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    toggle_popover(tray.app_handle(), rect);
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Builds the popover at launch, hidden.
///
/// Not on first click, for two reasons. The frontend is what reads the config,
/// so until it has run there is no vault being watched and no shortcut
/// registered - an app that did nothing until you opened it once would be a
/// menu bar app that has to be woken up before its global hotkey works. And
/// building a webview takes long enough to feel, which is not what the first
/// click of the day should feel like.
fn create_popover(app: &AppHandle) {
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

    // Nothing else can report this: there is no window to report it in.
    if let Err(error) = built {
        eprintln!("planner: could not create the popover: {error}");
    }
}

/// Shows the popover under the menu bar item, or puts it away if it is
/// already up. Clicking the icon a second time closing it is what every other
/// menu bar app does, and what people expect.
fn toggle_popover(app: &AppHandle, icon: tauri::Rect) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        eprintln!("planner: the popover is missing");
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    position(app, &window, icon);
    if let Err(error) = window.show() {
        eprintln!("planner: could not show the popover: {error}");
    }
    let _ = window.set_focus();
}

/// Puts the popover under the menu bar item.
///
/// The icon's rectangle arrives in physical pixels. The screen it is on
/// decides the scale factor, so a second display at a different scale places
/// the popover correctly rather than at twice - or half - the right offset.
fn position(app: &AppHandle, window: &tauri::WebviewWindow, icon: tauri::Rect) {
    // Already physical on macOS, where the scale factor is ignored; the
    // argument only matters for a platform that reports a logical rectangle.
    let at = icon.position.to_physical::<f64>(1.0);
    let size = icon.size.to_physical::<f64>(1.0);
    let icon = Bounds { x: at.x, y: at.y, width: size.width, height: size.height };

    let monitor = app
        .monitor_from_point(icon.x, icon.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());

    let screen = monitor.as_ref().map(|monitor| Bounds {
        x: monitor.position().x as f64,
        y: monitor.position().y as f64,
        width: monitor.size().width as f64,
        height: monitor.size().height as f64,
    });

    // The window's own scale factor is the fallback: wrong only if the icon is
    // on a display the window is not, which beats assuming 1.0 on a Retina
    // screen - the assumption this whole module exists to correct.
    let scale = match &monitor {
        Some(monitor) => monitor.scale_factor(),
        None => window.scale_factor().unwrap_or(1.0),
    };

    let (x, y) = popover::origin(icon, screen, scale, WIDTH, HEIGHT);
    // A popover that cannot be moved opens wherever it last was, which looks
    // like the click did nothing at all.
    if let Err(error) = window.set_position(tauri::LogicalPosition::new(x, y)) {
        eprintln!("planner: could not move the popover to {x},{y}: {error}");
    }
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
