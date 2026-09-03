//! The page a plugin is served, and the one escaping rule that page needs.

use planner_lib::plugins::serving::in_html;
use serde_json::json;

#[test]
fn an_ordinary_value_is_just_json() {
    assert_eq!(in_html(&json!({"pattern": "#(\\d+)"})), r##"{"pattern":"#(\\d+)"}"##);
}

#[test]
fn a_closing_script_tag_cannot_end_the_page() {
    // The whole reason this is not `literal()`: a text setting containing
    // `</script>` would otherwise close the block before `ready()` ran, and
    // the plugin would hang until its deadline with nothing to show for it.
    let written = in_html(&json!({"url": "</script><script>fetch('http://evil')</script>"}));
    assert!(!written.contains("</script"), "{written}");
    assert!(!written.contains("<script"), "{written}");
}

#[test]
fn angle_brackets_and_ampersands_are_written_as_escapes() {
    let written = in_html(&json!("<&>"));
    assert!(!written.contains('<'));
    assert!(!written.contains('>'));
    assert!(written.contains("\\u003c"));
}

#[test]
fn the_line_separators_are_escaped_too() {
    // JSON is nearly a subset of JavaScript. These two are where it is not.
    let written = in_html(&json!("a\u{2028}b\u{2029}c"));
    assert!(!written.contains('\u{2028}'));
    assert!(!written.contains('\u{2029}'));
}

#[test]
fn what_comes_out_is_still_the_value_that_went_in() {
    let value = json!({"a": "</script>", "b": "<&>\u{2028}"});
    let written = in_html(&value);
    let read: serde_json::Value = serde_json::from_str(&written).expect("not JSON any more");
    assert_eq!(read, value);
}
