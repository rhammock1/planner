//! The quick-add window and the shortcut that opens it (spec §5.2).
//!
//! One field, anywhere on the system, in under three seconds. It is a separate
//! window rather than the popover because the popover is anchored to the menu
//! bar, and the whole point of this one is that it appears wherever you are.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const QUICK_ADD: &str = "quickadd";
const WIDTH: f64 = 520.0;
const HEIGHT: f64 = 96.0;

/// Registers the shortcut, replacing whatever was registered before.
///
/// The accelerator comes from the frontend, which read it out of the config;
/// Rust does not parse TOML.
pub fn set_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut: Shortcut = accelerator.parse().map_err(|_| {
        format!("{accelerator} is not a shortcut this system understands")
    })?;

    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    let handle = app.clone();
    manager
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            // Fire on the press. Waiting for the release adds a delay you can
            // feel on something meant to take three seconds.
            if event.state == ShortcutState::Pressed {
                show(&handle);
            }
        })
        .map_err(|error| format!("could not register {accelerator}: {error}"))
}

/// Opens the field, or brings it forward if it is already open.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(QUICK_ADD) {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let built = WebviewWindowBuilder::new(app, QUICK_ADD, WebviewUrl::App("quickadd.html".into()))
        .title("Quick add")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .build();

    match built {
        Ok(window) => {
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(error) => eprintln!("planner: could not open quick add: {error}"),
    }
}

/// Puts the field away. Called when it is done with, or dismissed.
pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(QUICK_ADD) {
        let _ = window.hide();
    }
}
