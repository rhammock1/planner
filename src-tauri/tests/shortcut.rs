//! Accelerators as they are written back to the reader.

use planner_lib::shortcut::symbols;

#[test]
fn the_default_shortcut() {
    assert_eq!(symbols("Alt+Space"), "⌥+Space");
}

#[test]
fn every_modifier_has_a_symbol() {
    assert_eq!(symbols("CmdOrCtrl+Shift+Alt+Ctrl+P"), "⌘+⇧+⌥+⌃+P");
    assert_eq!(symbols("Command+Option+K"), "⌘+⌥+K");
    assert_eq!(symbols("Super+Control+J"), "⌘+⌃+J");
}

#[test]
fn case_does_not_matter() {
    assert_eq!(symbols("alt+space"), "⌥+space");
    assert_eq!(symbols("ALT+Space"), "⌥+Space");
}

// A key the config named is passed through untouched: this is a label, not a
// validator, and a shortcut that will not parse should be shown as written so
// the error message names something the user can find in their file.
#[test]
fn an_unknown_key_is_left_alone() {
    assert_eq!(symbols("Alt+F13"), "⌥+F13");
    assert_eq!(symbols("Hyper+X"), "Hyper+X");
    assert_eq!(symbols(""), "");
}
