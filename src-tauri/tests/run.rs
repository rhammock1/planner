//! Binding a command's placeholders against the rules its manifest declared.
//!
//! The whole of `shell.run`'s safety is here and in the path rules next to it:
//! by the time these arguments exist, nothing else stands between a plugin and
//! a process. So every rule is checked on this side of the boundary as well as
//! on the JavaScript side, and the two are not allowed to be the same code.

use std::path::Path;

use planner_lib::plugins::run::{bind, Bind, Command, Rule};
use serde_json::json;

fn home() -> &'static Path {
    Path::new("/Users/someone")
}

fn log() -> Command {
    Command {
        name: "log".into(),
        command: vec![
            "git".into(),
            "-C".into(),
            "{repo}".into(),
            "log".into(),
            "--since={from} 00:00".into(),
        ],
        binds: vec![
            Bind {
                name: "repo".into(),
                rule: Rule::Setting { key: "repo".into(), value: Some("~/gotab/node".into()) },
            },
            Bind { name: "from".into(), rule: Rule::Date },
        ],
    }
}

#[test]
fn a_bound_command_is_the_length_its_manifest_wrote_it() {
    let bound = bind(&log(), &json!({"from": "2026-09-02"}), home()).unwrap();
    assert_eq!(
        bound,
        vec![
            "git",
            "-C",
            "/Users/someone/gotab/node",
            "log",
            "--since=2026-09-02 00:00",
        ]
    );
}

#[test]
fn a_value_with_a_space_in_it_is_still_one_argument() {
    // The point of an argument list. A shell would make two of this.
    let command = Command {
        name: "log".into(),
        command: vec!["git".into(), "-C".into(), "{repo}".into()],
        binds: vec![Bind {
            name: "repo".into(),
            rule: Rule::Setting { key: "repo".into(), value: Some("/two words/here".into()) },
        }],
    };
    let bound = bind(&command, &json!({}), home()).unwrap();
    assert_eq!(bound, vec!["git", "-C", "/two words/here"]);
}

#[test]
fn a_value_that_looks_like_a_placeholder_is_not_one() {
    // Substitution is one pass over the template. What was put in is never
    // read again, so a value carrying `{repo}` is a value and not a hole.
    let command = Command {
        name: "echo".into(),
        command: vec!["echo".into(), "{a}".into(), "{b}".into()],
        binds: vec![
            Bind { name: "a".into(), rule: Rule::Setting { key: "a".into(), value: Some("{b}".into()) } },
            Bind { name: "b".into(), rule: Rule::Setting { key: "b".into(), value: Some("second".into()) } },
        ],
    };
    let bound = bind(&command, &json!({}), home()).unwrap();
    assert_eq!(bound, vec!["echo", "{b}", "second"]);
}

#[test]
fn a_date_must_be_a_day() {
    for wrong in ["2026-9-02", "today", "2026-09-02; rm -rf /", "", "2026-13-01"] {
        let refused = bind(&log(), &json!({"from": wrong}), home());
        assert!(refused.is_err(), "{wrong} was bound as a day");
    }
}

#[test]
fn a_setting_comes_from_the_grant_and_the_call_is_not_consulted() {
    // The rule this task turns on. The call names a different repository, and
    // the grant's is what runs - not because the other one was caught, but
    // because nothing looked at it. A `settings.<key>` has exactly one value
    // it could hold, so there is nothing for a caller to say about it.
    let bound = bind(&log(), &json!({"repo": "/somewhere/else", "from": "2026-09-02"}), home()).unwrap();
    assert_eq!(bound[2], "/Users/someone/gotab/node");
}

#[test]
fn a_setting_nobody_set_binds_to_nothing_at_all() {
    let mut command = log();
    command.binds[0].rule = Rule::Setting { key: "repo".into(), value: None };
    let refused = bind(&command, &json!({"from": "2026-09-02"}), home());
    // Named, because the person is the one who can fix it and the plugin has
    // to be able to say which row is empty.
    assert!(refused.unwrap_err().contains("repo"));
}

#[test]
fn a_value_that_is_not_a_string_is_not_a_value() {
    // Only a `date` is read off the call, so only a `date` can be the wrong
    // kind of thing.
    for wrong in [json!(4), json!(null), json!(["a"]), json!({})] {
        let refused = bind(&log(), &json!({"from": wrong}), home());
        assert!(refused.is_err(), "{wrong} was bound");
    }
}

#[test]
fn a_missing_value_is_refused_rather_than_left_as_a_hole() {
    let refused = bind(&log(), &json!({}), home());
    assert!(refused.is_err());
}

#[test]
fn only_a_leading_tilde_is_a_home_directory() {
    let expanded = |value: &str| {
        let command = Command {
            name: "echo".into(),
            command: vec!["echo".into(), "{a}".into()],
            binds: vec![Bind {
                name: "a".into(),
                rule: Rule::Setting { key: "a".into(), value: Some(value.into()) },
            }],
        };
        bind(&command, &json!({}), home()).unwrap()[1].clone()
    };
    assert_eq!(expanded("~/gotab/node"), "/Users/someone/gotab/node");
    assert_eq!(expanded("~"), "/Users/someone");
    // Not a home directory: somebody else's, and a path that merely has one in
    // the middle of it.
    assert_eq!(expanded("~other/thing"), "~other/thing");
    assert_eq!(expanded("/a/~/b"), "/a/~/b");
    // And a `~` that stays one. `Path::join` drops what it is joined to when
    // the other half is absolute, so the obvious expansion of `~//tmp/evil` is
    // `/tmp/evil` - which is not what the line said.
    assert_eq!(expanded("~//tmp/evil"), "/Users/someone/tmp/evil");
    assert_eq!(expanded("~/"), "/Users/someone");
}

#[test]
fn a_placeholder_the_manifest_never_bound_refuses_the_whole_call() {
    // The JavaScript reader refuses this manifest, so it should never arrive -
    // which is exactly why Rust checks it: this side is the boundary.
    let command = Command {
        name: "log".into(),
        command: vec!["git".into(), "-C".into(), "{repo}".into()],
        binds: vec![],
    };
    assert!(bind(&command, &json!({"repo": "/anywhere"}), home()).is_err());
}

#[test]
fn a_placeholder_that_spans_two_arguments_refuses_the_whole_call() {
    let command = Command {
        name: "log".into(),
        command: vec!["git".into(), "--since={from".into(), "00:00}".into()],
        binds: vec![Bind { name: "from".into(), rule: Rule::Date }],
    };
    assert!(bind(&command, &json!({"from": "2026-09-02"}), home()).is_err());
}

#[test]
fn an_empty_command_is_not_a_command() {
    let command = Command { name: "nothing".into(), command: vec![], binds: vec![] };
    assert!(bind(&command, &json!({}), home()).is_err());
}

#[test]
fn a_program_may_not_be_bound() {
    let command = Command {
        name: "anything".into(),
        command: vec!["{prog}".into()],
        binds: vec![Bind {
            name: "prog".into(),
            rule: Rule::Setting { key: "prog".into(), value: Some("sh".into()) },
        }],
    };
    assert!(bind(&command, &json!({}), home()).is_err());
}

#[test]
fn the_rules_arrive_the_way_the_frontend_sends_them() {
    // The seam, in one test: what `plan()` puts on the wire has to be what
    // serde reads off it, and neither side is allowed to drift alone.
    let read: Command = serde_json::from_value(json!({
        "name": "log",
        "command": ["git", "-C", "{repo}"],
        "binds": [
            {"name": "repo", "rule": "setting", "key": "repo", "value": "~/gotab/node"},
            {"name": "from", "rule": "date"}
        ]
    }))
    .expect("the frontend's shape did not parse");
    assert_eq!(read.binds.len(), 2);
    assert!(matches!(read.binds[1].rule, Rule::Date));
}

use planner_lib::plugins::run::answer;

#[test]
fn what_a_command_said_reaches_the_plugin_as_three_fields() {
    let said = answer(planner_lib::plugins::spawning::Finished {
        status: Some(0),
        stdout: b"Robert\tone thing\n".to_vec(),
        stderr: Vec::new(),
    });
    assert_eq!(said["status"], serde_json::json!(0));
    assert_eq!(said["stdout"], serde_json::json!("Robert\tone thing\n"));
    assert_eq!(said["stderr"], serde_json::json!(""));
}

#[test]
fn a_killed_command_has_no_status_at_all() {
    // Null rather than a number, so "it took too long" and "it exited 0" are
    // not the same answer to a plugin (spec §6).
    let said = answer(planner_lib::plugins::spawning::Finished {
        status: None,
        stdout: Vec::new(),
        stderr: b"...".to_vec(),
    });
    assert!(said["status"].is_null());
}

#[test]
fn a_command_is_handed_exactly_three_variables() {
    // The whole environment, and the promise `docs/plugins.md` makes. Planner
    // may have been launched from a terminal holding a token, a proxy and a
    // `GIT_DIR`; none of them is a plugin's to inherit.
    let given = planner_lib::plugins::run::environment(Path::new("/Users/someone"));
    let names: Vec<&str> = given.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, vec!["PATH", "HOME", "LANG"]);
    assert_eq!(given[1].1, "/Users/someone");
    assert!(given[0].1.contains('/'), "the PATH is not a path: {}", given[0].1);
}

#[test]
fn output_that_is_not_text_still_comes_back_as_text() {
    // A program is not obliged to speak UTF-8, and a plugin is handed a string
    // either way rather than a call that failed for a reason nobody can act on.
    let said = answer(planner_lib::plugins::spawning::Finished {
        status: Some(0),
        stdout: vec![0xff, 0xfe, b'h', b'i'],
        stderr: Vec::new(),
    });
    assert!(said["stdout"].as_str().expect("not a string").ends_with("hi"));
}
