//! The arithmetic behind the calendar's range cap.
//!
//! Civil days, not seconds: two dates a daylight-saving change apart are
//! still one day apart, and a cap measured in instants would disagree.

use planner_lib::bridges::calendar::{days_between, MAX_SPAN};

#[test]
fn a_day_is_a_day() {
    assert_eq!(days_between("2026-09-02", "2026-09-02"), Some(0));
    assert_eq!(days_between("2026-09-02", "2026-09-03"), Some(1));
    assert_eq!(days_between("2026-09-03", "2026-09-02"), Some(-1));
}

#[test]
fn months_and_years_and_leap_days() {
    assert_eq!(days_between("2026-01-31", "2026-02-01"), Some(1));
    assert_eq!(days_between("2026-01-01", "2027-01-01"), Some(365));
    // 2024 is a leap year and 2100 is not, which is the rule a naive
    // divisible-by-four would get wrong.
    assert_eq!(days_between("2024-02-28", "2024-03-01"), Some(2));
    assert_eq!(days_between("2100-02-28", "2100-03-01"), Some(1));
}

/// Daylight saving in the United States moved on 2026-03-08. A span measured
/// in hours would call this 0.958 days and round it to nothing.
#[test]
fn a_clock_change_does_not_move_a_day() {
    assert_eq!(days_between("2026-03-07", "2026-03-08"), Some(1));
    assert_eq!(days_between("2026-11-01", "2026-11-02"), Some(1));
}

#[test]
fn what_is_not_a_day_is_not_a_number() {
    for text in ["", "2026-9-02", "2026/09/02", "not-a-date", "2026-09-02T09:00", "2026-13-01", "2026-09-32"] {
        assert_eq!(days_between(text, "2026-09-02"), None, "{text} was read as a day");
        assert_eq!(days_between("2026-09-02", text), None, "{text} was read as a day");
    }
}

#[test]
fn the_cap_is_two_months() {
    assert_eq!(MAX_SPAN, 62);
    // The widest question this app asks is a month view with a month of lead
    // either side of it, and that fits.
    assert!(days_between("2026-09-01", "2026-10-31").expect("a span") <= MAX_SPAN);
    assert!(days_between("2026-01-01", "2026-12-31").expect("a span") > MAX_SPAN);
}
