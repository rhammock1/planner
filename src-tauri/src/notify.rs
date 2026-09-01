//! Alarms for today's timed lines (spec §5.9).
//!
//! The schedule is worked out in JavaScript and arrives here complete: every
//! alarm still ahead, in one call, replacing whatever was held before. Rust
//! does not know what an item is and never asks - it holds instants and rings
//! at them.
//!
//! It is Rust's job because it cannot be JavaScript's. The popover is a hidden
//! webview almost all of the time, and WKWebView throttles timers in a hidden
//! webview: a `setTimeout` for eleven o'clock fires somewhere after eleven,
//! or after the next time you open the page, which is not a reminder.

use std::collections::HashMap;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// How late an alarm can be and still be worth ringing.
///
/// A laptop that was shut at six and opened at nine has five alarms whose
/// moment has gone. Firing them all is a stack of notifications about a
/// morning that already happened, and a stack of those is how a person turns
/// notifications off for good.
const GRACE: i64 = 5 * 60 * 1000;

/// How often the frontend is asked for the schedule again.
///
/// Not because the set goes stale on its own, but because midnight does not
/// announce itself: at some point today's alarms are all in the past and
/// tomorrow's have never been sent. An event is the only way to reach a
/// hidden webview reliably - it is timers that are throttled, not messages.
const REFRESH: Duration = Duration::from_secs(15 * 60);

const REFRESH_EVENT: &str = "schedule:refresh";

/// One line, and the moment it is owed at.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Alarm {
    /// Milliseconds since the epoch. Worked out in JavaScript, against the
    /// clock on the wall, because that is where this app keeps its one
    /// opinion about what local time means.
    pub at: i64,
    /// `HH:MM`, for the notification to show.
    pub time: String,
    pub text: String,
}

#[derive(Default)]
struct Held {
    pending: Vec<Alarm>,
    /// What has already been rung, and when.
    ///
    /// The frontend recomputes the schedule on every change to the vault, and
    /// a recomputation that began a moment before an alarm fired would hand
    /// that alarm straight back. Remembered for long enough to refuse it.
    fired: HashMap<String, i64>,
}

/// The schedule, and the thread waiting on it.
#[derive(Default)]
pub struct Alarms {
    held: Mutex<Held>,
    woken: Condvar,
}

/// Replaces the whole schedule (spec §5.9).
///
/// Everything already gone, and everything already rung, is dropped on the
/// way in - so sending the same set twice is not the same as ringing twice.
#[tauri::command]
pub fn set_notifications(alarms: tauri::State<'_, Alarms>, list: Vec<Alarm>) {
    let now = millis_now();
    let mut held = alarms.held.lock().expect("alarms lock");
    let kept = list
        .into_iter()
        .filter(|alarm| alarm.at > now && !held.fired.contains_key(&key(alarm)))
        .collect();
    held.pending = kept;
    drop(held);

    // The thread may be parked until a quarter past; the new set may be owed
    // at five past. Wake it so it can work out the wait again.
    alarms.woken.notify_all();
}

/// Starts the one thread that holds the timers. Called once, at setup.
pub fn hold(app: AppHandle) {
    std::thread::spawn(move || loop {
        let alarms = app.state::<Alarms>();

        let (ringing, wait) = {
            let mut held = alarms.held.lock().expect("alarms lock");
            let now = millis_now();
            let (ringing, keep) = due(&held.pending, now, GRACE);
            held.pending = keep;
            for alarm in &ringing {
                held.fired.insert(key(alarm), now);
            }
            held.fired.retain(|_, when| now - *when < GRACE * 2);
            (ringing, next_wake(&held.pending, now, REFRESH))
        };

        for alarm in &ringing {
            announce(&app, alarm);
        }

        // Asked for after ringing, never before: the frontend drops alarms
        // whose moment has gone, so a set computed now is a set without the
        // ones just rung.
        if let Err(error) = app.emit_to(crate::tray::POPOVER, REFRESH_EVENT, ()) {
            eprintln!("planner: could not ask for the schedule again: {error}");
        }

        let held = alarms.held.lock().expect("alarms lock");
        let _ = alarms.woken.wait_timeout(held, wait);
    });
}

/// Splits a schedule into what is owed now and what is still ahead.
///
/// `grace` is how late is still worth saying; anything later is dropped
/// without a word, because it is the machine that was away, not the person.
pub fn due(pending: &[Alarm], now: i64, grace: i64) -> (Vec<Alarm>, Vec<Alarm>) {
    let mut ringing = Vec::new();
    let mut keep = Vec::new();
    for alarm in pending {
        if alarm.at > now {
            keep.push(alarm.clone());
        } else if now - alarm.at <= grace {
            ringing.push(alarm.clone());
        }
    }
    (ringing, keep)
}

/// How long to wait before looking again: the next alarm, or `refresh`,
/// whichever comes first.
pub fn next_wake(pending: &[Alarm], now: i64, refresh: Duration) -> Duration {
    match pending.iter().map(|alarm| alarm.at).filter(|at| *at > now).min() {
        Some(at) => refresh.min(Duration::from_millis((at - now) as u64)),
        None => refresh,
    }
}

/// The line is the notification's title and the time is its body, because the
/// line is what you need to read and the time is what you already know.
fn announce(app: &AppHandle, alarm: &Alarm) {
    let shown = app
        .notification()
        .builder()
        .title(alarm.text.clone())
        .body(alarm.time.clone())
        .show();

    // Nothing on screen would say this failed - that is the whole of what
    // failed - so it is said here (spec §11.8).
    if let Err(error) = shown {
        eprintln!("planner: could not announce {} at {}: {error}", alarm.text, alarm.time);
    }
}

/// Identity for "already rung". The moment and the words together: two lines
/// at the same time are two alarms, and the same line moved to a new time is
/// a new one.
fn key(alarm: &Alarm) -> String {
    format!("{}\u{0}{}", alarm.at, alarm.text)
}

fn millis_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alarm(at: i64, text: &str) -> Alarm {
        Alarm { at, time: "09:30".into(), text: text.into() }
    }

    const NOW: i64 = 1_000_000;
    const FIVE_MINUTES: i64 = 5 * 60 * 1000;

    #[test]
    fn an_alarm_still_ahead_is_kept_and_not_rung() {
        let (ringing, keep) = due(&[alarm(NOW + 1, "Standup")], NOW, FIVE_MINUTES);
        assert!(ringing.is_empty());
        assert_eq!(keep.len(), 1);
    }

    #[test]
    fn an_alarm_whose_moment_has_come_rings_and_is_taken_off() {
        let (ringing, keep) = due(&[alarm(NOW, "Standup")], NOW, FIVE_MINUTES);
        assert_eq!(ringing.len(), 1);
        assert!(keep.is_empty());
    }

    #[test]
    fn an_alarm_a_little_late_still_rings() {
        let (ringing, _) = due(&[alarm(NOW - FIVE_MINUTES, "Standup")], NOW, FIVE_MINUTES);
        assert_eq!(ringing.len(), 1);
    }

    /// The machine was asleep. Saying it now is noise, and noise is how
    /// notifications get turned off.
    #[test]
    fn an_alarm_long_past_is_dropped_without_a_word() {
        let (ringing, keep) = due(&[alarm(NOW - FIVE_MINUTES - 1, "Standup")], NOW, FIVE_MINUTES);
        assert!(ringing.is_empty());
        assert!(keep.is_empty());
    }

    #[test]
    fn the_wait_is_until_the_soonest_alarm() {
        let pending = [alarm(NOW + 9_000, "Later"), alarm(NOW + 3_000, "Sooner")];
        assert_eq!(next_wake(&pending, NOW, REFRESH), Duration::from_secs(3));
    }

    #[test]
    fn an_alarm_beyond_the_refresh_does_not_stretch_the_wait() {
        let pending = [alarm(NOW + 60 * 60 * 1000, "Tonight")];
        assert_eq!(next_wake(&pending, NOW, REFRESH), REFRESH);
    }

    /// Nothing left today still wakes: midnight has to be noticed somehow.
    #[test]
    fn an_empty_schedule_waits_for_the_refresh() {
        assert_eq!(next_wake(&[], NOW, REFRESH), REFRESH);
    }

    #[test]
    fn an_alarm_already_gone_is_not_what_the_wait_is_measured_to() {
        let pending = [alarm(NOW - 5_000, "Gone"), alarm(NOW + 4_000, "Ahead")];
        assert_eq!(next_wake(&pending, NOW, REFRESH), Duration::from_secs(4));
    }

    #[test]
    fn two_lines_at_the_same_moment_are_two_alarms() {
        assert_ne!(key(&alarm(NOW, "Standup")), key(&alarm(NOW, "Retro")));
    }

    #[test]
    fn the_same_line_moved_to_a_new_time_is_a_new_alarm() {
        assert_ne!(key(&alarm(NOW, "Standup")), key(&alarm(NOW + 1, "Standup")));
    }
}
