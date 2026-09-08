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
use std::ffi::OsStr;
use std::path::Path;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2_core_location::{CLAuthorizationStatus, CLLocationManager};
use serde_json::{json, Value};
use tauri::AppHandle;

/// Two decimal places, as a divisor.
const PLACES: f64 = 100.0;

/// How long a call waits for the main thread to read a property.
///
/// Not how long it waits for a *fix* - nothing waits for that. This is only
/// how long the hop itself gets.
const HOP: Duration = Duration::from_secs(1);

/// How long a fix stands before CoreLocation is asked for another.
///
/// The alarm thread's own period, because that is the fastest anything here is
/// re-asked. Without it a plugin could call this in a loop, and two things
/// follow from that which the rounding alone does not prevent: rounding a
/// *noisy* signal thousands of times reveals where inside the square the true
/// point sits, and a plugin watching the square change learns when somebody
/// left the house. One fix per refresh is all a sunset needs.
const AGAIN: Duration = Duration::from_secs(15 * 60);

/// Where this Mac was, already rounded, and when that was worked out.
///
/// Rounded here rather than on the way out, so the finer number is not kept at
/// all. Nothing downstream can be careless with a precision this does not
/// hold, and repeated sampling has nothing finer to average.
static SEEN: Mutex<Option<(Instant, f64, f64)>> = Mutex::new(None);

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

    // Answered, or nothing. A hop that ran out is *not* a reason to fall back
    // on what was last seen: the answer that did not arrive may have been the
    // refusal that follows somebody switching location services off, and
    // handing back the last fix would go on saying where this Mac used to be
    // for as long as the app stayed open.
    match hear.recv_timeout(HOP) {
        Ok(said) => said?,
        Err(_) => {
            return Err(
                "Planner could not reach macOS to ask where this Mac is; open the page again in \
                 a moment"
                    .into(),
            )
        }
    }

    let seen = *SEEN.lock().expect("location lock");
    let Some((_, latitude, longitude)) = seen else {
        return Err(
            "Planner is asking macOS where this Mac is; open the page again in a moment".into(),
        );
    };
    Ok(json!({ "latitude": latitude, "longitude": longitude }))
}

/// The main thread's half: ask for permission if it has not been asked, and
/// otherwise copy out whatever CoreLocation currently believes.
fn ask_macos() -> Result<(), String> {
    MANAGER.with(|held| {
        let manager = held.get_or_init(|| unsafe { CLLocationManager::new() });
        let status = unsafe { manager.authorizationStatus() };

        match status {
            CLAuthorizationStatus::NotDetermined => {
                // Said before asking, because from here the ask cannot land and
                // the honest message is a different one. Left as "Planner is
                // asking", a dev build shows a notice about a prompt that is
                // never coming, on every draw, for as long as it runs.
                if !bundled() {
                    return Err("This build cannot ask macOS for permission: it is not an app \
                                bundle, so the prompt never appears. Type where you are into \
                                the plugin's own setting, or run Planner.app \
                                (tools/update --bundle)."
                        .to_string());
                }

                // Fire and forget: the prompt waits for a person, and nothing
                // else in this app is willing to.
                unsafe { manager.requestWhenInUseAuthorization() };
                Err("Planner is asking macOS for permission to know where this Mac is".to_string())
            }
            // Both, and the spike is why: `requestWhenInUseAuthorization` on
            // the desktop is answered with `AuthorizedAlways`, not the value
            // its own name suggests.
            CLAuthorizationStatus::AuthorizedAlways | CLAuthorizationStatus::AuthorizedWhenInUse => {
                // A fix that is still standing is the answer. Asking again
                // would light the radios and the menu bar's arrow for nothing:
                // a Mac that has moved a kilometre since the last quarter hour
                // has been closed and opened on the way.
                if let Some((at, _, _)) = *SEEN.lock().expect("location lock") {
                    if at.elapsed() < AGAIN {
                        return Ok(());
                    }
                }

                // Repeated calls are harmless and this is the only place that
                // knows the authorization has landed - which, the first time,
                // is some seconds after it was asked for.
                unsafe { manager.startUpdatingLocation() };
                if let Some(fix) = unsafe { manager.location() } {
                    let at = unsafe { fix.coordinate() };
                    *SEEN.lock().expect("location lock") = Some((
                        Instant::now(),
                        (at.latitude * PLACES).round() / PLACES,
                        (at.longitude * PLACES).round() / PLACES,
                    ));
                    // Stopped the moment there is one. Left running, this keeps
                    // the radios scanning and the location arrow in the menu bar
                    // lit for as long as the app is open - and what this needs is
                    // one fix per launch to the nearest kilometre, not a track.
                    unsafe { manager.stopUpdatingLocation() };
                }
                Ok(())
            }
            // Named, and with the way out named too: a plugin that goes quiet
            // because a system setting is off is a bug report with no first
            // line (spec §8, §6).
            //
            // The last fix goes with it. Permission can be taken back while
            // the app is running, and a refusal that left the cache standing
            // would be a refusal only until the next call read around it.
            _ => {
                *SEEN.lock().expect("location lock") = None;
                Err("Planner is not allowed to know where this Mac is. \
                     System Settings › Privacy & Security › Location Services. \
                     Or type where you are into the plugin's own setting."
                    .to_string())
            }
        }
    })
}

/// Whether this executable is running from inside an app bundle.
///
/// Which is exactly the difference between a permission that can be asked for
/// and one that cannot. cargo's binary carries `Info.plist` in a `__TEXT`
/// section the signature does not seal; TCC will not read an unsealed plist,
/// so `requestWhenInUseAuthorization` leaves the status at `NotDetermined` with
/// no prompt and no refusal (docs/testing.md, and the header of this file).
fn bundled() -> bool {
    // Resolved first. `planner` on somebody's PATH is a symlink into the build
    // cache (tools/update keeps it pointing at the bundle), and the path this
    // hands back is allowed to be the link rather than what it points at - so
    // without this the app would run from the bundle, hold the permission, and
    // still print the notice that says it cannot have one.
    let Ok(exe) = std::env::current_exe() else { return false };
    in_bundle(&std::fs::canonicalize(&exe).unwrap_or(exe))
}

/// The shape of the path, split out so it can be checked without one.
///
/// A path test rather than a signature test: reading the seal means shelling
/// out to `codesign`, and this runs on the main thread while the popover is
/// waiting. Being wrong costs a notice that names the wrong remedy, which is
/// still better than the one that names a prompt that is not coming.
fn in_bundle(exe: &Path) -> bool {
    let Some(macos) = exe.parent() else { return false };
    if !macos.ends_with("Contents/MacOS") {
        return false;
    }
    macos
        .parent()
        .and_then(|contents| contents.parent())
        .and_then(|app| app.extension())
        == Some(OsStr::new("app"))
}

#[cfg(test)]
mod tests {
    use super::in_bundle;
    use std::path::Path;

    #[test]
    fn a_bundled_binary_is_recognised() {
        assert!(in_bundle(Path::new(
            "/Users/someone/.cache/planner-target/Planner.app/Contents/MacOS/planner"
        )));
    }

    #[test]
    fn a_cargo_binary_is_not() {
        // The one that matters: this is what `npm run app` runs, and the whole
        // point of the check is that it cannot be asked a permission question.
        assert!(!in_bundle(Path::new(
            "/Users/someone/.cache/planner-target/debug/planner"
        )));
    }

    #[test]
    fn the_folders_have_to_be_the_bundle_s_own() {
        // Not any Contents/MacOS anywhere - a bundle is a `.app` with those
        // two inside it, and a directory that merely shares the names is not
        // one macOS will read a plist out of.
        assert!(!in_bundle(Path::new("/tmp/Planner/Contents/MacOS/planner")));
        assert!(!in_bundle(Path::new("/tmp/Planner.app/MacOS/planner")));
        assert!(!in_bundle(Path::new("planner")));
    }
}
