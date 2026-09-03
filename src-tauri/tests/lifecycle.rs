//! Stopping a plugin, and what a stop must leave behind.
//!
//! The window half of this needs a running app and is checked by hand
//! (`docs/testing.md`). What is here is everything a stop touches that is not
//! a window: the questions it settles, the readiness it forgets, and the
//! judgement it must not clear.

use planner_lib::plugins::waiting::{Pending, Started};
use planner_lib::plugins::Registry;
use std::time::{Duration, Instant};

fn granted() -> Registry {
    let registry = Registry::default();
    registry.grant(
        "ticket-links",
        "index.js".into(),
        vec!["item.badge".into()],
        vec!["shell.open".into()],
    );
    registry
}

#[test]
fn a_stopped_plugin_is_asked_nothing() {
    let registry = granted();
    assert_eq!(registry.running_for("item.badge"), vec!["ticket-links"]);
    registry.stop("ticket-links");
    assert!(registry.running_for("item.badge").is_empty());
}

#[test]
fn starting_it_again_makes_it_askable_again() {
    let registry = granted();
    registry.stop("ticket-links");
    registry.grant("ticket-links", "index.js".into(), vec!["item.badge".into()], Vec::new());
    assert_eq!(registry.running_for("item.badge"), vec!["ticket-links"]);
}

#[test]
fn a_stop_does_not_forgive_a_plugin_that_was_put_away() {
    // The whole point of §1.2: switching a plugin off and on again is not an
    // appeal, because the person doing it does not know what it did.
    let registry = granted();
    registry.disable("ticket-links", "did not answer within 2s");
    registry.stop("ticket-links");
    registry.grant("ticket-links", "index.js".into(), vec!["item.badge".into()], Vec::new());
    assert!(registry.disabled("ticket-links"));
    assert!(registry.running_for("item.badge").is_empty());
}

#[test]
fn a_stop_settles_every_question_that_plugin_was_holding() {
    let pending = Pending::default();
    let (_, mine) = pending.ask_of("ticket-links");
    let (_, other) = pending.ask_of("macos-calendar");

    pending.settle_all_of("ticket-links", "ticket-links is restarting");

    // A failure, not a timeout: a plugin being restarted has not missed a
    // deadline, and putting a healthy one away for having been restarted
    // would make the pane's switch unusable (spec §1.2).
    let said = mine.recv_timeout(Duration::from_millis(50)).expect("no answer");
    assert!(said.is_err());
    assert!(said.unwrap_err().contains("restarting"));

    // And nobody else's question was touched.
    assert!(other.recv_timeout(Duration::from_millis(20)).is_err());
    assert_eq!(pending.open(), 1);
}

#[test]
fn a_restarted_plugin_has_to_say_ready_again() {
    let started = Started::default();
    started.mark("ticket-links");
    assert!(started.wait("ticket-links", Instant::now() + Duration::from_millis(50)));

    started.forget("ticket-links");
    // Nothing is asked of it until its new page has finished loading.
    assert!(!started.wait("ticket-links", Instant::now() + Duration::from_millis(20)));
}

#[test]
fn the_pane_is_told_what_a_plugin_did() {
    let registry = granted();
    registry.disable("ticket-links", "did not answer within 2s");

    let states = registry.states();
    let one = states.iter().find(|state| state.name == "ticket-links").expect("not listed");
    assert!(one.disabled);
    assert_eq!(one.reason.as_deref(), Some("did not answer within 2s"));
}

#[test]
fn a_plugin_that_is_simply_running_has_nothing_to_explain() {
    let states = granted().states();
    let one = states.first().expect("not listed");
    assert!(!one.disabled);
    assert!(one.running);
    assert_eq!(one.reason, None);
}

#[test]
fn the_first_reason_is_the_true_one() {
    // A plugin already put away for hanging, then refused a capability, was
    // not put away for asking.
    let registry = granted();
    registry.disable("ticket-links", "did not answer within 2s");
    registry.disable("ticket-links", "asked three times for something it was not granted");
    let states = registry.states();
    assert_eq!(states[0].reason.as_deref(), Some("did not answer within 2s"));
}

#[test]
fn the_states_come_back_in_a_settled_order() {
    let registry = Registry::default();
    for name in ["zulu", "alpha"] {
        registry.grant(name, "index.js".into(), Vec::new(), Vec::new());
    }
    let names: Vec<String> = registry.states().into_iter().map(|state| state.name).collect();
    assert_eq!(names, vec!["alpha".to_string(), "zulu".to_string()]);
}
