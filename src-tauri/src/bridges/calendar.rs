//! `macos.calendar.read` - today's events, out of the same store the Calendar
//! app reads.
//!
//! Read only, and there is no write bridge to add later: a planner that can
//! move your meetings is a calendar app, and this is not one.
//!
//! Everything unsafe about EventKit is confined here. What leaves this file
//! is `{date, time, text, allDay}` with the dates already in local time,
//! because the plugin above is pure logic and has no business knowing what a
//! timezone is (addendum §5).

use std::sync::OnceLock;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStatus, EKEventStore};
use objc2_foundation::{NSDate, NSDateFormatter, NSError, NSLocale, NSString};
use serde_json::{json, Value};

/// EventKit hands back absolute instants. A planner page is a local day, so
/// the two are reconciled once, here, and nowhere else.
const DAY: &str = "yyyy-MM-dd";
const CLOCK: &str = "HH:mm";
const BOTH: &str = "yyyy-MM-dd HH:mm:ss";

/// The events between two local days, inclusive.
///
/// @param params `{from, to}`, each `YYYY-MM-DD`
pub fn events(params: &Value) -> Result<Value, String> {
    let from = day_of(params, "from")?;
    let to = day_of(params, "to")?;

    authorized()?;

    // A fresh store each time. EventKit caches, and a store held across a
    // change in the Calendar app goes on reporting what it read at startup.
    let store = unsafe { EKEventStore::new() };

    let starts = parse(&format!("{from} 00:00:00"))?;
    let ends = parse(&format!("{to} 23:59:59"))?;

    let found = unsafe {
        // No calendar list: every calendar the account has. Which ones matter
        // is a question for a settings pane, not for a first plugin.
        let predicate = store.predicateForEventsWithStartDate_endDate_calendars(&starts, &ends, None);
        store.eventsMatchingPredicate(&predicate)
    };

    let days = formatter(DAY);
    let clock = formatter(CLOCK);
    let mut events = Vec::new();

    for event in found.iter() {
        let (text, start, all_day, status) =
            unsafe { (event.title(), event.startDate(), event.isAllDay(), event.status()) };

        events.push(json!({
            "date": days.stringFromDate(&start).to_string(),
            // An all-day thing has no hour to show. Sending one anyway would
            // put `00:00` beside every public holiday.
            "time": if all_day { Value::Null } else { Value::from(clock.stringFromDate(&start).to_string()) },
            "text": text.to_string(),
            "allDay": all_day,
            // Passed on rather than filtered here: whether a cancelled
            // meeting is worth a line on a planner page is the plugin's
            // decision to make, and a bridge that decided it would be a
            // bridge with an opinion (spec §7.5).
            "status": status_of(status),
        }));
    }

    Ok(Value::Array(events))
}

/// EventKit's status as a word, so a plugin does not have to know that
/// cancelled is three.
fn status_of(status: EKEventStatus) -> &'static str {
    match status {
        EKEventStatus::Confirmed => "confirmed",
        EKEventStatus::Tentative => "tentative",
        EKEventStatus::Canceled => "cancelled",
        _ => "none",
    }
}

/// Whether the calendar may be read, and if not, what to do about it.
///
/// The first ask happens the first time a plugin wants events, and cannot be
/// waited for: the prompt is modal and the person may be at lunch. So the
/// request goes off on its own and this call fails politely. The events
/// appear the next time the popover is opened.
fn authorized() -> Result<(), String> {
    let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };

    match status {
        EKAuthorizationStatus::FullAccess => Ok(()),
        EKAuthorizationStatus::NotDetermined => {
            ask();
            Err("Planner is asking macOS for permission to read your calendar".into())
        }
        EKAuthorizationStatus::WriteOnly => {
            Err("Planner may add to your calendar but not read it".into())
        }
        _ => Err(
            "Planner is not allowed to read your calendar. \
             System Settings › Privacy & Security › Calendars."
                .into(),
        ),
    }
}

/// Asks macOS for calendar access, once per launch.
///
/// On its own thread, because the prompt waits for a person and nothing else
/// in this app is willing to.
fn ask() {
    static ASKED: OnceLock<()> = OnceLock::new();
    if ASKED.set(()).is_err() {
        return;
    }

    std::thread::spawn(|| unsafe {
        let store = EKEventStore::new();
        let done = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            if granted.as_bool() {
                eprintln!("planner: the calendar may be read");
                return;
            }
            // Never swallowed: a plugin that quietly shows nothing is a bug
            // report with no first line (spec §8).
            let said = if error.is_null() {
                "the request was refused".to_string()
            } else {
                (*error).localizedDescription().to_string()
            };
            eprintln!("planner: the calendar may not be read - {said}");
        });
        store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&done) as *mut _);
    });
}

/// @param key `from` or `to`
fn day_of(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|day| day.len() == 10 && day.as_bytes()[4] == b'-')
        .map(str::to_string)
        .ok_or_else(|| format!("{key} is not a day"))
}

/// A local midnight-to-midnight instant from a written-down day.
fn parse(when: &str) -> Result<Retained<NSDate>, String> {
    formatter(BOTH)
        .dateFromString(&NSString::from_str(when))
        .ok_or_else(|| format!("{when} is not a time"))
}

/// A formatter in the machine's own timezone.
///
/// The locale is pinned to `en_US_POSIX` even though the format is fixed:
/// without it, a machine set to a non-Gregorian calendar formats `yyyy` as a
/// year this app would not recognise.
fn formatter(format: &str) -> Retained<NSDateFormatter> {
    let formatter = NSDateFormatter::new();
    formatter.setDateFormat(Some(&NSString::from_str(format)));
    formatter.setLocale(Some(&NSLocale::localeWithLocaleIdentifier(&NSString::from_str(
        "en_US_POSIX",
    ))));
    formatter
}
