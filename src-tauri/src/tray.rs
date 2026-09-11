//! The menu bar item and the popover it opens.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

use crate::cli::Intent;
use crate::popover::{self, Bounds};

/// The day page. Public so alarms can ask it for a fresh schedule.
pub const POPOVER: &str = "popover";

/// The menu bar item's id, so it can be found again to be labelled.
const TRAY: &str = "planner";

/// The size the popover opens at the first time. After that it is whatever
/// the user has dragged it to.
const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 560.0;

/// Small enough to tuck away, big enough to still be a page.
const MIN_WIDTH: f64 = 300.0;
const MIN_HEIGHT: f64 = 240.0;

/// Whether the popover has been pinned open.
///
/// An unpinned popover is a glance: look at the day, click away, it is gone.
/// A pinned one is a page left open on the desk, and stays until it is closed.
#[derive(Default)]
struct Pinned(AtomicBool);

/// When the popover last put itself away because it lost focus. See
/// `popover::opens`.
#[derive(Default)]
struct HiddenAt(Mutex<Option<Instant>>);

/// What the command line asked for at launch, until a window can act on it.
///
/// Taken rather than read: a launch happens once, and a page that reloads
/// should not reopen what the first load already opened.
#[derive(Default)]
pub struct Launch(Mutex<Option<Intent>>);

impl From<Intent> for Launch {
    fn from(intent: Intent) -> Self {
        Launch(Mutex::new(Some(intent)))
    }
}

impl Launch {
    /// The intent, once. `None` every time after that.
    pub fn take(app: &AppHandle) -> Option<Intent> {
        app.try_state::<Launch>()
            .and_then(|launch| launch.0.lock().ok().and_then(|mut held| held.take()))
    }
}

/// Pins or unpins the popover. Called by the pin in the page header.
#[tauri::command]
pub fn set_pinned(app: AppHandle, pinned: bool) {
    if let Some(state) = app.try_state::<Pinned>() {
        state.0.store(pinned, Ordering::Relaxed);
    }
}

/// Labels the menu bar icon with what today still holds (spec §5.8).
///
/// The text is worked out in JavaScript - it is the same count the footer
/// shows, and there is one place in this project that decides what "open"
/// means. Rust is told what to draw, not how to count.
#[tauri::command]
pub fn set_badge(app: AppHandle, text: Option<String>) {
    let Some(tray) = app.tray_by_id(TRAY) else {
        // Nothing on screen would change and nothing would say why.
        eprintln!("planner: no menu bar icon to label");
        return;
    };

    // macOS is the only platform where an icon can carry text beside it. The
    // app is macOS-only (spec §2), so elsewhere this is simply not drawn
    // rather than faked into a tooltip nobody hovers.
    #[cfg(target_os = "macos")]
    if let Err(error) = tray.set_title(text.as_deref()) {
        eprintln!("planner: could not label the menu bar icon: {error}");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = text;
}

/// Puts the popover away - what Escape does, and what the pin does when it is
/// clicked off.
#[tauri::command]
pub fn close_popover(app: AppHandle) {
    if let Some(window) = app.get_webview_window(POPOVER) {
        if let Err(error) = window.hide() {
            eprintln!("planner: could not hide the popover: {error}");
        }
    }
}

/// The day page saying it has finished starting.
///
/// This is the moment the popover can be shown without showing a blank one:
/// `create_popover` builds the webview at launch, but building it is not
/// loading it. The same race `spread_view` answers by having the window ask
/// as it starts - and the same answer, from the other direction.
#[tauri::command]
pub fn popover_ready(app: AppHandle) {
    if let Some(Intent::Today) = Launch::take(&app) {
        show_popover(&app);
    }
}

/// Shows the popover where the menu bar item would have shown it.
///
/// The tray icon's rectangle is asked for rather than handed in, because
/// nobody clicked anything: this is `planner`, typed. A pinned page stays
/// where it was put, and an icon that will not report its rectangle - a full
/// menu bar hides the item, which is one of the cases this exists for - falls
/// back to wherever the window already is. Visible and slightly wrong beats
/// hidden and exactly right, which is the rule `popover::origin` already
/// follows.
pub fn show_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        eprintln!("planner: the popover is missing");
        return;
    };

    if !is_pinned(app) {
        if let Some(icon) = app.tray_by_id(TRAY).and_then(|tray| tray.rect().ok().flatten()) {
            position(app, &window, icon);
        }
    }

    if let Err(error) = window.show() {
        eprintln!("planner: could not show the popover: {error}");
    }
    let _ = window.set_focus();

    // The same refresh a click gets, for the same reason: opening the page is
    // asking what today looks like.
    if let Err(error) = window.emit("popover:shown", ()) {
        eprintln!("planner: could not tell the page it was opened: {error}");
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    app.manage(crate::watcher::Watchers::default());
    app.manage(Pinned::default());
    app.manage(HiddenAt::default());
    create_popover(app);

    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::with_id(TRAY);
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
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // The app's own origin only. The same hook fires for subframes, and
        // the app has none (spec §0.2).
        .on_navigation(crate::plugins::app_navigable)
        .build();

    // Nothing else can report this: there is no window to report it in.
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            eprintln!("planner: could not create the popover: {error}");
            return;
        }
    };

    // Clicking away puts an unpinned popover down, the way closing a notebook
    // you have finished glancing at does.
    let handle = app.clone();
    window.on_window_event(move |event| {
        let WindowEvent::Focused(false) = event else { return };
        if is_pinned(&handle) {
            return;
        }

        if let Some(at) = handle.try_state::<HiddenAt>() {
            if let Ok(mut when) = at.0.lock() {
                when.replace(Instant::now());
            }
        }
        if let Some(window) = handle.get_webview_window(POPOVER) {
            if let Err(error) = window.hide() {
                eprintln!("planner: could not put the popover away: {error}");
            }
        }
    });
}

/// Whether the popover has been pinned open.
fn is_pinned(app: &AppHandle) -> bool {
    app.try_state::<Pinned>()
        .map(|state| state.0.load(Ordering::Relaxed))
        .unwrap_or(false)
}

/// Shows the popover under the menu bar item, or puts it away if it is
/// already up. Clicking the icon a second time closing it is what every other
/// menu bar app does, and what people expect.
fn toggle_popover(app: &AppHandle, icon: tauri::Rect) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        eprintln!("planner: the popover is missing");
        return;
    };

    let since_hidden = app
        .try_state::<HiddenAt>()
        .and_then(|at| at.0.lock().ok().and_then(|when| *when))
        .map(|when| when.elapsed());

    if !popover::opens(window.is_visible().unwrap_or(false), since_hidden) {
        if let Err(error) = window.hide() {
            eprintln!("planner: could not put the popover away: {error}");
        }
        return;
    }

    // A pinned page stays where it was put. Only a page that closes the moment
    // you look away is re-anchored under the icon every time, because that is
    // the one place a glance always comes from. macOS keeps a hidden window's
    // frame, so leaving it alone is the whole of remembering it.
    if !is_pinned(app) {
        position(app, &window, icon);
    }
    if let Err(error) = window.show() {
        eprintln!("planner: could not show the popover: {error}");
    }
    let _ = window.set_focus();

    // Opening the popover is asking what today looks like, so what the
    // plugins have to say about it is asked again now rather than being
    // whatever they said at launch. It is also the moment a calendar
    // permission granted a minute ago first has an effect.
    if let Err(error) = window.emit("popover:shown", ()) {
        eprintln!("planner: could not tell the page it was opened: {error}");
    }
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

    // The window's own size, not the size it was built at: it is resizable,
    // and anchoring a 520-wide popover as though it were 380 puts it off
    // centre by seventy points.
    let size = window
        .inner_size()
        .map(|size| size.to_logical::<f64>(scale))
        .unwrap_or(tauri::LogicalSize::new(WIDTH, HEIGHT));

    let (x, y) = popover::origin(icon, screen, scale, size.width, size.height);
    // A popover that cannot be moved opens wherever it last was, which looks
    // like the click did nothing at all.
    if let Err(error) = window.set_position(tauri::LogicalPosition::new(x, y)) {
        eprintln!("planner: could not move the popover to {x},{y}: {error}");
    }
}
