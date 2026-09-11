//! The detached window (spec §5.6): the week, the month, and the back page.
//!
//! An ordinary window, with the system's own frame, that stays where you put
//! it while you work. The popover is a glance and closes itself; this is the
//! surface you leave open on a second display, so it gets none of the
//! popover's tricks - no anchoring, no always-on-top, no hiding on blur.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const SPREAD: &str = "spread";

/// The view that shows a file. Not one of `VIEWS` in
/// `src/views/spreadViews.js` - that list is read by the day page's footer
/// too, and a tab there that opened an empty window would be a promise the
/// app does not keep (spec §3.3). This string must match the key the window
/// registers that view under.
const FILE: &str = "file";

/// Roomy enough for seven columns of a week, and a month grid under them.
const WIDTH: f64 = 880.0;
const HEIGHT: f64 = 600.0;
const MIN_WIDTH: f64 = 480.0;
const MIN_HEIGHT: f64 = 320.0;

/// Which of the views the window should be showing.
///
/// Kept here rather than passed in the URL because the window outlives the
/// click that opened it: pressing WEEK and then MONTH before the webview has
/// finished loading would otherwise race, and the second press would be lost.
/// The frontend asks for this as it starts, and listens for later changes.
#[derive(Default)]
pub struct View(Mutex<Option<String>>);

/// The file the window should be showing, if it has been handed one.
///
/// Kept here for the reason `View` is: the window outlives the invocation
/// that opened it, and a second `planner <path>` arriving before this webview
/// has finished loading would otherwise be lost. The frontend asks for this
/// as it starts, and listens for later ones.
#[derive(Default)]
pub struct Asked(Mutex<Option<String>>);

/// Opens the window on a view, or brings it forward and switches to it.
#[tauri::command]
pub fn open_spread(app: AppHandle, view: String) {
    if let Some(state) = app.try_state::<View>() {
        if let Ok(mut held) = state.0.lock() {
            held.replace(view.clone());
        }
    }

    let Some(window) = app.get_webview_window(SPREAD) else {
        create(&app);
        return;
    };

    // Already built, and possibly showing something else. Only the spread
    // window listens for this; the popover ignores it.
    if let Err(error) = app.emit("spread:view", view) {
        eprintln!("planner: could not switch the window's view: {error}");
    }
    if let Err(error) = window.show() {
        eprintln!("planner: could not show the window: {error}");
    }
    let _ = window.set_focus();
}

/// Opens the window on a file, or brings it forward and shows that one.
///
/// The view is set as well as the file: a window opened by `planner <path>`
/// coming up on the week would be a command that did something other than
/// what it said.
pub fn open_file(app: &AppHandle, path: PathBuf) {
    let named = path.to_string_lossy().into_owned();

    if let Some(state) = app.try_state::<Asked>() {
        if let Ok(mut held) = state.0.lock() {
            held.replace(named.clone());
        }
    }
    if let Some(state) = app.try_state::<View>() {
        if let Ok(mut held) = state.0.lock() {
            held.replace(FILE.to_string());
        }
    }

    let Some(window) = app.get_webview_window(SPREAD) else {
        // Not built yet. It asks for both of the above as it starts, so
        // there is nothing to emit at a window that is not there.
        create(app);
        return;
    };

    if let Err(error) = app.emit("spread:file", named) {
        eprintln!("planner: could not hand the window a file: {error}");
    }
    if let Err(error) = app.emit("spread:view", FILE) {
        eprintln!("planner: could not switch the window to the file: {error}");
    }
    if let Err(error) = window.show() {
        eprintln!("planner: could not show the window: {error}");
    }
    // The app has no dock icon (`ActivationPolicy::Accessory`) and whatever
    // invoked this is a terminal that is frontmost. If the window turns out
    // to raise without taking focus, this is the line that needs help from
    // `objc2` - see spec §1.4, and the smoke checklist.
    let _ = window.set_focus();
}

/// `planner <path>.md`, as a command for the app's own windows.
#[tauri::command]
pub fn open_spread_file(app: AppHandle, path: String) {
    open_file(&app, PathBuf::from(path));
}

/// The file the window was last handed. Read once as the window starts.
#[tauri::command]
pub fn spread_file(app: AppHandle) -> Option<String> {
    app.try_state::<Asked>()
        .and_then(|state| state.0.lock().ok().and_then(|held| held.clone()))
}

/// The view the window was last asked for. Read once as the window starts.
#[tauri::command]
pub fn spread_view(app: AppHandle) -> Option<String> {
    app.try_state::<View>()
        .and_then(|state| state.0.lock().ok().and_then(|held| held.clone()))
}

/// Builds the window, once. Later opens show the one that already exists.
///
/// Not at launch, unlike the popover: this one is opened deliberately, and a
/// webview nobody has asked for is a webview's worth of memory spent on the
/// chance they will.
fn create(app: &AppHandle) {
    let built = WebviewWindowBuilder::new(app, SPREAD, WebviewUrl::App("spread.html".into()))
        .title("Planner")
        .inner_size(WIDTH, HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .resizable(true)
        .center()
        .visible(false)
        // The app's own origin only. The same hook fires for subframes, and
        // the app has none (spec §0.2).
        .on_navigation(crate::plugins::app_navigable)
        .build();

    let window = match built {
        Ok(window) => window,
        Err(error) => {
            eprintln!("planner: could not open the window: {error}");
            return;
        }
    };

    // Closing puts it away rather than destroying it. Rebuilding a webview
    // takes long enough to feel, and this is a window people close and reopen
    // through the day.
    let handle = app.clone();
    window.on_window_event(move |event| {
        let WindowEvent::CloseRequested { api, .. } = event else { return };
        api.prevent_close();
        if let Some(window) = handle.get_webview_window(SPREAD) {
            if let Err(error) = window.hide() {
                eprintln!("planner: could not put the window away: {error}");
            }
        }
    });

    if let Err(error) = window.show() {
        eprintln!("planner: could not show the window: {error}");
    }
    let _ = window.set_focus();
}
