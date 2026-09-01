//! The popover's placement, checked without a screen.

use planner_lib::popover::{origin, Bounds};

const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 560.0;

/// A 14" MacBook Pro: 3024x1964 physical, 1512x982 logical.
fn retina() -> Bounds {
    Bounds { x: 0.0, y: 0.0, width: 3024.0, height: 1964.0 }
}

/// The rectangle the tray reported on the machine this bug was found on.
fn icon() -> Bounds {
    Bounds { x: 1844.0, y: 0.0, width: 68.0, height: 66.0 }
}

#[test]
fn the_popover_lands_on_screen_at_2x() {
    let (x, y) = origin(icon(), Some(retina()), 2.0, WIDTH, HEIGHT);

    // The icon's centre is 1878 physical, 939 logical; half the popover's
    // width to the left of that is 749.
    assert_eq!(x, 749.0);
    assert!(x + WIDTH <= 1512.0, "ran off the right edge at x={x}");
    assert!(y > 0.0 && y + HEIGHT <= 982.0, "off the screen vertically at y={y}");
}

#[test]
fn it_hangs_below_the_icon_not_over_it() {
    let (_, y) = origin(icon(), Some(retina()), 2.0, WIDTH, HEIGHT);
    // The icon is 66 physical tall from y=0, so 33 logical, plus the gap.
    assert_eq!(y, 39.0);
}

#[test]
fn it_is_centred_under_the_icon() {
    let (x, _) = origin(icon(), Some(retina()), 2.0, WIDTH, HEIGHT);
    let centre = (1844.0 + 68.0 / 2.0) / 2.0;
    assert_eq!(x + WIDTH / 2.0, centre);
}

#[test]
fn a_non_retina_screen_needs_no_division() {
    let screen = Bounds { x: 0.0, y: 0.0, width: 1512.0, height: 982.0 };
    let icon = Bounds { x: 922.0, y: 0.0, width: 34.0, height: 33.0 };
    let (x, y) = origin(icon, Some(screen), 1.0, WIDTH, HEIGHT);
    assert_eq!(x, 749.0);
    assert_eq!(y, 39.0);
}

// An item at the far right of a crowded menu bar. Half the popover would
// hang off the screen if it were simply centred.
#[test]
fn an_icon_near_the_right_edge_is_pulled_back_on() {
    let icon = Bounds { x: 2960.0, y: 0.0, width: 68.0, height: 66.0 };
    let (x, _) = origin(icon, Some(retina()), 2.0, WIDTH, HEIGHT);
    assert_eq!(x, 1512.0 - WIDTH - 8.0);
}

// A second display sits at its own physical offset; the popover belongs on
// that screen, not at the same coordinates on the first one.
#[test]
fn a_second_display_keeps_its_own_offset() {
    let screen = Bounds { x: 3024.0, y: 0.0, width: 2560.0, height: 1440.0 };
    let icon = Bounds { x: 3024.0 + 1200.0, y: 0.0, width: 34.0, height: 33.0 };
    let (x, _) = origin(icon, Some(screen), 1.0, WIDTH, HEIGHT);
    assert_eq!(x, 3024.0 + 1200.0 + 17.0 - WIDTH / 2.0);
}

// Nothing here may divide by a scale factor of zero and place the window at
// infinity, which is a position a window never comes back from.
#[test]
fn a_nonsense_scale_factor_still_lands_somewhere() {
    let (x, y) = origin(icon(), Some(retina()), 0.0, WIDTH, HEIGHT);
    assert!(x.is_finite() && y.is_finite());
}

// A screen narrower than the popover crosses the two clamp bounds, which
// panics if they are passed in the wrong order.
#[test]
fn a_screen_narrower_than_the_popover_does_not_panic() {
    let screen = Bounds { x: 0.0, y: 0.0, width: 320.0, height: 480.0 };
    let icon = Bounds { x: 160.0, y: 0.0, width: 34.0, height: 33.0 };
    let (x, y) = origin(icon, Some(screen), 1.0, WIDTH, HEIGHT);
    assert_eq!(x, 8.0);
    assert!(y.is_finite());
}

// The screen cannot always be identified. The popover still goes under the
// icon; it is only the clamp that needs to know where the edges are.
#[test]
fn an_unknown_screen_still_places_it_under_the_icon() {
    let (x, y) = origin(icon(), None, 2.0, WIDTH, HEIGHT);
    assert_eq!(x, 749.0);
    assert_eq!(y, 39.0);
}

mod clicking {
    use planner_lib::popover::opens;
    use std::time::Duration;

    #[test]
    fn a_click_opens_a_popover_that_is_not_up() {
        assert!(opens(false, None));
    }

    #[test]
    fn a_click_closes_one_that_is() {
        assert!(!opens(true, None));
    }

    // The click that closed it arrives after the blur that hid it. Opening
    // then would mean the icon could never be used to put the popover away.
    #[test]
    fn the_click_that_hid_it_does_not_reopen_it() {
        assert!(!opens(false, Some(Duration::from_millis(0))));
        assert!(!opens(false, Some(Duration::from_millis(120))));
        assert!(!opens(false, Some(Duration::from_millis(399))));
    }

    #[test]
    fn a_later_click_opens_it_again() {
        assert!(opens(false, Some(Duration::from_millis(400))));
        assert!(opens(false, Some(Duration::from_secs(3))));
    }
}
