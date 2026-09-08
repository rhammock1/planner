//! Stopping a plugin, and what a stop must leave behind.
//!
//! The window half of this needs a running app and is checked by hand
//! (`docs/testing.md`). What is here is everything a stop touches that is not
//! a window: the questions it settles, the readiness it forgets, and the
//! judgement it must not clear.

use planner_lib::plugins::waiting::{Pending, Started};
use planner_lib::plugins::registry::Granting;
use planner_lib::plugins::Registry;
use std::time::{Duration, Instant};

fn granted() -> Registry {
    let registry = Registry::default();
    registry.grant(Granting {
        name: "ticket-links".into(),
        entry: "index.js".into(),
        slots: vec!["item.badge".into()],
        capabilities: vec!["shell.open".into()],
        open: Vec::new(),
        run: Vec::new(),
        asked: vec!["shell.open".into()],
        asked_run: Vec::new(),
        settings: serde_json::json!({}),
    });
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
    registry.grant(Granting {
        name: "ticket-links".into(),
        entry: "index.js".into(),
        slots: vec!["item.badge".into()],
        capabilities: Vec::new(),
        open: Vec::new(),
        run: Vec::new(),
        asked: Vec::new(),
        asked_run: Vec::new(),
        settings: serde_json::json!({}),
    });
    assert_eq!(registry.running_for("item.badge"), vec!["ticket-links"]);
}

#[test]
fn a_stop_does_not_forgive_a_plugin_that_was_put_away() {
    // The whole point of §1.2: switching a plugin off and on again is not an
    // appeal, because the person doing it does not know what it did.
    let registry = granted();
    registry.disable("ticket-links", "did not answer within 2s");
    registry.stop("ticket-links");
    registry.grant(Granting {
        name: "ticket-links".into(),
        entry: "index.js".into(),
        slots: vec!["item.badge".into()],
        capabilities: Vec::new(),
        open: Vec::new(),
        run: Vec::new(),
        asked: Vec::new(),
        asked_run: Vec::new(),
        settings: serde_json::json!({}),
    });
    assert!(registry.disabled("ticket-links"));
    assert!(registry.running_for("item.badge").is_empty());
}

#[test]
fn a_stopped_plugin_is_not_answered_for_what_it_may_open() {
    // Switching a plugin off is withdrawing consent, not just closing its
    // webview - the last grant must not go on answering `open_url` until
    // something happens to overwrite it.
    let registry = Registry::default();
    registry.grant(Granting {
        name: "ticket-links".into(),
        entry: "index.js".into(),
        slots: Vec::new(),
        capabilities: Vec::new(),
        open: vec!["https://github.com/gotab-inc/node/pull/".into()],
        run: Vec::new(),
        asked: Vec::new(),
        asked_run: Vec::new(),
        settings: serde_json::json!({}),
    });
    assert_eq!(
        registry.may_open("ticket-links"),
        vec!["https://github.com/gotab-inc/node/pull/"],
        "a running plugin was refused what it was granted",
    );

    registry.stop("ticket-links");
    assert!(registry.may_open("ticket-links").is_empty(), "a stopped plugin was still answered");
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
        registry.grant(Granting {
        name: name.into(),
        entry: "index.js".into(),
        slots: Vec::new(),
        capabilities: Vec::new(),
        open: Vec::new(),
        run: Vec::new(),
        asked: Vec::new(),
        asked_run: Vec::new(),
        settings: serde_json::json!({}),
    });
    }
    let names: Vec<String> = registry.states().into_iter().map(|state| state.name).collect();
    assert_eq!(names, vec!["alpha".to_string(), "zulu".to_string()]);
}

#[test]
fn a_stopped_plugin_may_run_nothing() {
    // The same rule `may_open` follows: switching a plugin off has to withdraw
    // what it may reach at once, rather than leaving the last grant answerable.
    let registry = Registry::default();
    registry.grant(Granting {
        name: "git-activity".into(),
        entry: "index.js".into(),
        slots: vec!["vault.contribute".into()],
        capabilities: vec!["shell.run".into()],
        open: Vec::new(),
        run: vec![planner_lib::plugins::run::Command {
            name: "log".into(),
            command: vec!["git".into(), "log".into()],
            binds: Vec::new(),
        }],
        asked: vec!["shell.run".into()],
        asked_run: Vec::new(),
        settings: serde_json::Value::Object(Default::default()),
    });
    assert_eq!(registry.run_of("git-activity").map(|held| held.len()), Some(1));

    // `None`, not an empty list, and the difference is the whole point: a
    // stopped plugin is refused without a strike, where one asking for a
    // command it never declared is struck. An empty `Vec` could not tell the
    // caller which of the two had happened.
    registry.stop("git-activity");
    assert!(registry.run_of("git-activity").is_none());
    assert!(registry.run_of("never-started").is_none());
}

#[test]
fn what_a_manifest_declared_outlives_what_the_config_ticked() {
    // The difference between a refusal and a strike. A plugin whose manifest
    // asks for `shell.run` and whose config has not ticked it is waiting on a
    // decision; one asking for something it never declared is not what it said
    // it was (spec §1.2).
    let registry = Registry::default();
    registry.grant(Granting {
        name: "git-activity".into(),
        entry: "index.js".into(),
        capabilities: Vec::new(),
        asked: vec!["shell.run".into()],
        asked_run: vec!["log".into()],
        ..Default::default()
    });

    assert!(registry.declared("git-activity", "capability", "shell.run"));
    assert!(registry.declared("git-activity", "run", "log"));
    // Granted nothing, so neither is permitted - but both were declared.
    assert!(!registry.permits("git-activity", "shell.run"));

    // Never declared, in either namespace.
    assert!(!registry.declared("git-activity", "capability", "macos.calendar.read"));
    assert!(!registry.declared("git-activity", "run", "push"));
    // And the two namespaces do not leak into one another.
    assert!(!registry.declared("git-activity", "run", "shell.run"));
    assert!(!registry.declared("git-activity", "capability", "log"));
    assert!(!registry.declared("never-started", "capability", "shell.run"));
}
