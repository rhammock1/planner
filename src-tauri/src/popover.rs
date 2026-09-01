//! Where the popover goes when the menu bar item is clicked.
//!
//! Kept apart from the window handling so it can be tested without a screen.
//! The arithmetic is the whole of the bug this module exists to prevent: a
//! tray icon's rectangle arrives in *physical* pixels, the window is placed in
//! *logical* points, and on any Retina display those differ by a factor of
//! two. Treating one as the other put the popover a screen's width off to the
//! right, where it opened, correctly, invisibly.

/// A rectangle in physical pixels, top-left origin - the shape both the tray
/// icon and the screen arrive in.
#[derive(Clone, Copy, Debug)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Space between the menu bar and the top of the popover.
const GAP: f64 = 6.0;

/// How close to the edge of the screen the popover may sit. An item at the
/// far right of a full menu bar would otherwise hang off it.
const MARGIN: f64 = 8.0;

/// The popover's top-left corner in logical points: centred under the icon,
/// below it, and - when the screen it is on is known - on it.
///
/// `icon` and `screen` are physical; the result is logical, because that is
/// what a window is positioned in. A `None` screen skips the clamp: visible
/// and slightly wrong beats hidden and exactly right.
pub fn origin(
    icon: Bounds,
    screen: Option<Bounds>,
    scale: f64,
    width: f64,
    height: f64,
) -> (f64, f64) {
    // A scale factor of zero would divide the position into infinity, and a
    // window placed there does not come back.
    let scale = if scale > 0.0 { scale } else { 1.0 };

    let x = (icon.x + icon.width / 2.0) / scale - width / 2.0;
    let y = (icon.y + icon.height) / scale + GAP;

    let Some(screen) = screen else { return (x, y) };

    let left = screen.x / scale + MARGIN;
    let right = (screen.x + screen.width) / scale - width - MARGIN;
    let top = screen.y / scale;
    let bottom = (screen.y + screen.height) / scale - height - MARGIN;

    // `max` before `clamp`: on a screen smaller than the popover the two
    // bounds cross, and clamp panics when they do.
    (x.clamp(left, right.max(left)), y.min(bottom.max(top)))
}
