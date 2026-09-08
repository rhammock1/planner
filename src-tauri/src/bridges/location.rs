//! `macos.location.read` - where this Mac is, roughly (spec §3.3).
//!
//! Rounded to two decimal places, which is about a kilometre: enough for
//! sunrise arithmetic and less than a plugin needs to know about where
//! somebody lives. There is no finer version of this bridge to add later.
//!
//! Everything CoreLocation touches runs on the main thread. A
//! `CLLocationManager` is neither `Send` nor `Sync` and wants a run loop, and
//! the app already has one there - so the manager lives in a thread-local on
//! that thread and the calling task hops over to read it. What it reads is
//! copied into a plain `Mutex`, which is what a later call answers from.
//!
//! Worth saying, because phase zero moved the *calendar* bridge off the main
//! thread and this is the opposite: EventKit's fetch blocks for as long as the
//! store takes, and the main thread is where the popover is drawn. Nothing in
//! `ask_macos` blocks on anything. It reads two properties and posts a request
//! that returns at once, and the caller - not the main thread - is the one
//! that waits, for at most `HOP`.
//!
//! The first call cannot succeed, and that is not a failure. macOS puts up a
//! prompt and the person may be at lunch; a fix arrives some seconds after
//! they allow it. So this fails politely and the answer appears the next time
//! the popover is opened - the same shape the calendar bridge has.
//!
//! One thing the Task 10 spike settled, because it is invisible from the code:
//! none of this happens at all under `cargo run`. Cargo's linker-signed binary
//! carries `Info.plist` unbound, TCC will not read an unbound plist, and
//! `requestWhenInUseAuthorization` then leaves the status at `NotDetermined`
//! for as long as the app runs - no prompt, no refusal. This bridge is checked
//! from a bundle (`src-tauri/Info.plist` says the rest).

use std::cell::OnceCell;
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use objc2::rc::Retained;
use objc2_core_location::{CLAuthorizationStatus, CLLocationManager};
use serde_json::{json, Value};
use tauri::AppHandle;

/// Two decimal places, as a divisor.
const PLACES: f64 = 100.0;

/// How long a call waits for the main thread to read a property.
///
/// Not how long it waits for a *fix* - nothing waits for that. This is only
/// how long the hop itself gets before the last known answer is used instead.
const HOP: Duration = Duration::from_secs(1);

/// The last fix, in the ordinary world where things are `Send`.
static SEEN: Mutex<Option<(f64, f64)>> = Mutex::new(None);

thread_local! {
    /// The manager, on the main thread and nowhere else.
    static MANAGER: OnceCell<Retained<CLLocationManager>> = const { OnceCell::new() };
}

/// Where this Mac is, or why it will not say.
pub fn location(app: &AppHandle) -> Result<Value, String> {
    let (told, hear) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = told.send(ask_macos());
    })
    .map_err(|error| format!("could not ask this Mac where it is: {error}"))?;

    // A main thread that is busy is not a failure: whatever was last seen is
    // still the answer, and if nothing has been, the message below says so.
    if let Ok(said) = hear.recv_timeout(HOP) {
        said?;
    }

    let seen = *SEEN.lock().expect("location lock");
    let Some((latitude, longitude)) = seen else {
        return Err(
            "Planner is asking macOS where this Mac is; open the page again in a moment".into(),
        );
    };
    Ok(json!({
        "latitude": (latitude * PLACES).round() / PLACES,
        "longitude": (longitude * PLACES).round() / PLACES,
    }))
}

/// The main thread's half: ask for permission if it has not been asked, and
/// otherwise copy out whatever CoreLocation currently believes.
fn ask_macos() -> Result<(), String> {
    MANAGER.with(|held| {
        let manager = held.get_or_init(|| unsafe { CLLocationManager::new() });
        let status = unsafe { manager.authorizationStatus() };

        match status {
            CLAuthorizationStatus::NotDetermined => {
                // Fire and forget: the prompt waits for a person, and nothing
                // else in this app is willing to.
                unsafe { manager.requestWhenInUseAuthorization() };
                Err("Planner is asking macOS for permission to know where this Mac is".to_string())
            }
            // Both, and the spike is why: `requestWhenInUseAuthorization` on
            // the desktop is answered with `AuthorizedAlways`, not the value
            // its own name suggests.
            CLAuthorizationStatus::AuthorizedAlways | CLAuthorizationStatus::AuthorizedWhenInUse => {
                // Repeated calls are harmless and this is the only place that
                // knows the authorization has landed - which, the first time,
                // is some seconds after it was asked for.
                unsafe { manager.startUpdatingLocation() };
                if let Some(fix) = unsafe { manager.location() } {
                    let at = unsafe { fix.coordinate() };
                    *SEEN.lock().expect("location lock") = Some((at.latitude, at.longitude));
                    // Stopped the moment there is one. Left running, this keeps
                    // the radios scanning and the location arrow in the menu bar
                    // lit for as long as the app is open - and what this needs is
                    // one fix per launch to the nearest kilometre, not a track. A
                    // Mac that has moved far enough to change a sunset has been
                    // closed and opened on the way.
                    unsafe { manager.stopUpdatingLocation() };
                }
                Ok(())
            }
            // Named, and with the way out named too: a plugin that goes quiet
            // because a system setting is off is a bug report with no first
            // line (spec §8, §6).
            _ => Err("Planner is not allowed to know where this Mac is. \
                      System Settings › Privacy & Security › Location Services. \
                      Or type where you are into the plugin's own setting."
                .to_string()),
        }
    })
}
