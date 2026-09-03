//! What a plugin may open. The boundary: this runs before anything is handed
//! to the system opener, and a string comparison here would be a hole.

use planner_lib::plugins::opening::{parse_prefix, within};
use tauri::Url;

fn url(text: &str) -> Url {
    Url::parse(text).expect("not a url")
}

#[test]
fn a_prefix_is_an_http_address_ending_in_a_slash() {
    assert!(parse_prefix("https://github.com/gotab-inc/node/pull/").is_some());
    assert!(parse_prefix("http://localhost:8080/t/").is_some());
}

#[test]
fn anything_else_is_not_a_prefix() {
    for bad in [
        "file:///etc/",
        "plugin://x/",
        "https://user@github.com/x/",
        "https://github.com/gotab-inc/node",
        "not a url",
    ] {
        assert!(parse_prefix(bad).is_none(), "{bad} was taken for a prefix");
    }
}

#[test]
fn a_url_under_the_prefix_is_opened() {
    let prefix = parse_prefix("https://github.com/gotab-inc/node/pull/").expect("prefix");
    assert!(within(&prefix, &url("https://github.com/gotab-inc/node/pull/4412")));
    assert!(within(&prefix, &url("https://github.com/gotab-inc/node/pull/4412?tab=files#c")));
    assert!(within(&prefix, &url("https://github.com/gotab-inc/node/pull/")));
}

#[test]
fn a_look_alike_host_is_not() {
    let prefix = parse_prefix("https://github.com/gotab-inc/node/pull/").expect("prefix");
    // The one a string comparison waves through.
    assert!(!within(&prefix, &url("https://github.com.evil.io/gotab-inc/node/pull/1")));
    assert!(!within(&prefix, &url("https://notgithub.com/gotab-inc/node/pull/1")));
}

#[test]
fn climbing_out_of_the_prefix_is_not() {
    let prefix = parse_prefix("https://github.com/gotab-inc/node/pull/").expect("prefix");
    assert!(!within(&prefix, &url("https://github.com/gotab-inc/node/pull/../../evil/1")));
}

#[test]
fn percent_encoded_climbing_is_not() {
    // `%2e%2e` stays encoded through `Url` rather than resolving the way a
    // literal `..` does - it is one path segment, and that segment is not
    // `pull`, so this is refused by the segment rule rather than by
    // normalisation. Exercised directly here because this is the boundary:
    // what runs before anything is handed to the system opener.
    let prefix = parse_prefix("https://github.com/gotab-inc/node/pull/").expect("prefix");
    assert!(!within(&prefix, &url("https://github.com/gotab-inc/node/pull/%2e%2e/evil")));
}

#[test]
fn a_sibling_that_starts_with_the_same_letters_is_not() {
    let prefix = parse_prefix("https://github.com/gotab-inc/node/pull/").expect("prefix");
    assert!(!within(&prefix, &url("https://github.com/gotab-inc/nodex/pull/1")));
}

#[test]
fn a_different_scheme_port_or_userinfo_is_not() {
    let prefix = parse_prefix("https://github.com/gotab-inc/node/pull/").expect("prefix");
    assert!(!within(&prefix, &url("http://github.com/gotab-inc/node/pull/1")));
    assert!(!within(&prefix, &url("https://github.com:8443/gotab-inc/node/pull/1")));
    assert!(!within(&prefix, &url("https://evil@github.com/gotab-inc/node/pull/1")));
}

#[test]
fn the_default_port_written_out_is_the_same_address() {
    let prefix = parse_prefix("https://github.com/x/").expect("prefix");
    assert!(within(&prefix, &url("https://github.com:443/x/1")));
}

#[test]
fn a_different_case_scheme_or_host_is_still_the_same_address() {
    // Scheme and host are case-insensitive, and `Url::parse` lowercases both
    // before `within` ever sees them - checked directly here rather than
    // trusted, since the boundary is exactly the place a case-sensitive
    // comparison would quietly start refusing addresses it should allow.
    let prefix = parse_prefix("https://github.com/gotab-inc/node/pull/").expect("prefix");
    assert!(within(&prefix, &url("HTTPS://GitHub.COM/gotab-inc/node/pull/1")));
}
