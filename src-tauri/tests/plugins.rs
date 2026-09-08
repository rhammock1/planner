//! The plugin sandbox's two rules: what a plugin window may call, and what a
//! plugin may reach once it has called it.

use planner_lib::plugins::registry::Granting;
use planner_lib::plugins::{allowed, plugin_of, Registry, DOOR};

#[test]
fn the_apps_own_windows_may_call_anything() {
    for window in ["popover", "quickadd", "spread"] {
        assert!(allowed(window, "write_page"), "{window} was refused write_page");
        assert!(allowed(window, DOOR), "{window} was refused the door");
    }
}

#[test]
fn a_plugin_window_may_call_the_door_and_nothing_else() {
    let plugin = "plugin-macos-calendar";
    assert!(allowed(plugin, DOOR));

    // Not a list of the dangerous ones - every command the app has, and every
    // command it will ever have.
    for command in ["write_page", "read_vault", "set_vault", "read_config", "start_plugin"] {
        assert!(!allowed(plugin, command), "a plugin got at {command}");
    }
}

#[test]
fn a_window_called_plugin_with_no_name_is_not_a_plugin() {
    // The prefix alone names nobody. Treating it as a plugin would leave a
    // window whose grants can never be found, permanently refused.
    assert_eq!(plugin_of("plugin-"), None);
    assert_eq!(plugin_of("popover"), None);
    assert_eq!(plugin_of("plugin-macos-calendar"), Some("macos-calendar"));
}

/// A plugin whose label merely starts with the word is still a plugin: the
/// prefix is what the gate reads, so nothing may borrow it.
#[test]
fn nothing_borrows_the_prefix() {
    assert!(!allowed("plugin-popover", "write_page"));
}

fn granted() -> Registry {
    let registry = Registry::default();
    registry.grant(Granting {
        name: "macos-calendar".into(),
        entry: "index.js".into(),
        slots: vec!["vault.contribute".into()],
        capabilities: vec!["macos.calendar.read".into()],
        asked: vec!["macos.calendar.read".into()],
        ..Default::default()
    });
    registry
}

#[test]
fn a_plugin_reaches_what_it_was_granted_and_no_more() {
    let registry = granted();
    assert!(registry.permits("macos-calendar", "macos.calendar.read"));
    assert!(!registry.permits("macos-calendar", "macos.reminders.read"));
    assert!(!registry.permits("macos-calendar", "fs.read"));

    // A plugin that was never started has no grants to find.
    assert!(!registry.permits("something-else", "macos.calendar.read"));
}

#[test]
fn asking_for_what_it_never_had_puts_it_away_eventually() {
    let registry = granted();

    // Once may be a stale manifest, and the plugin keeps working.
    assert!(!registry.strike("macos-calendar"));
    assert!(registry.permits("macos-calendar", "macos.calendar.read"));

    assert!(!registry.strike("macos-calendar"));
    assert!(registry.strike("macos-calendar"), "a third try was tolerated");

    // Put away means put away: what it was granted no longer counts.
    assert!(!registry.permits("macos-calendar", "macos.calendar.read"));
    assert!(registry.disabled("macos-calendar"));
}

#[test]
fn a_plugin_that_misses_its_deadline_is_not_asked_again() {
    let registry = granted();
    assert_eq!(registry.running_for("vault.contribute"), vec!["macos-calendar".to_string()]);

    registry.disable("macos-calendar", "did not answer within 2s");

    assert!(registry.running_for("vault.contribute").is_empty());
    assert!(!registry.permits("macos-calendar", "macos.calendar.read"));
}

#[test]
fn a_plugin_nobody_started_is_not_running() {
    assert!(Registry::default().running_for("vault.contribute").is_empty());
    assert!(Registry::default().disabled("macos-calendar"));
}

mod answers {
    use planner_lib::plugins::waiting::Pending;
    use serde_json::Value;

    #[test]
    fn a_plugin_gets_the_answer_to_its_own_question() {
        let pending = Pending::default();
        let (id, answer) = pending.ask_of("macos-calendar");

        assert_eq!(pending.settle("macos-calendar", id, Ok(Value::from(1))), Ok(()));
        assert_eq!(answer.try_recv(), Ok(Ok(Value::from(1))));
        assert_eq!(pending.open(), 0, "an answered question was left open");
    }

    /// Ids are numbers handed out in order, so the next one is always a guess
    /// away. Without this, a second plugin could put words in the first's
    /// mouth and the app would show them as the first's.
    #[test]
    fn a_plugin_cannot_answer_a_question_put_to_another() {
        let pending = Pending::default();
        let (id, answer) = pending.ask_of("macos-calendar");

        let refused = pending.settle("something-else", id, Ok(Value::from("mine now")));
        assert_eq!(
            refused,
            Err("something-else answered a question put to macos-calendar".into()),
        );

        // And the real plugin's question is still open, not consumed by the
        // attempt - it may yet answer.
        assert!(answer.try_recv().is_err());
        assert_eq!(pending.open(), 1);
        assert_eq!(pending.settle("macos-calendar", id, Ok(Value::from(2))), Ok(()));
        assert_eq!(answer.try_recv(), Ok(Ok(Value::from(2))));
    }

    #[test]
    fn two_plugins_asked_at_once_get_their_own_answers() {
        let pending = Pending::default();
        let (first, one) = pending.ask_of("alpha");
        let (second, two) = pending.ask_of("beta");
        assert_ne!(first, second);

        assert_eq!(pending.settle("beta", second, Ok(Value::from("b"))), Ok(()));
        assert_eq!(pending.settle("alpha", first, Ok(Value::from("a"))), Ok(()));

        assert_eq!(one.try_recv(), Ok(Ok(Value::from("a"))));
        assert_eq!(two.try_recv(), Ok(Ok(Value::from("b"))));
    }

    /// The deadline passed, the page was drawn without it, and the answer
    /// turned up afterwards. Nobody to tell, and nothing wrong.
    #[test]
    fn an_answer_nobody_is_waiting_for_is_not_an_offence() {
        let pending = Pending::default();
        let (id, _) = pending.ask_of("macos-calendar");
        pending.forget(id);

        assert_eq!(pending.settle("macos-calendar", id, Ok(Value::Null)), Ok(()));
        // Including from a plugin that was never asked anything at all.
        assert_eq!(pending.settle("something-else", 4141, Ok(Value::Null)), Ok(()));
    }

    #[test]
    fn a_failure_reaches_the_asker_as_a_failure() {
        let pending = Pending::default();
        let (id, answer) = pending.ask_of("macos-calendar");

        assert_eq!(pending.settle("macos-calendar", id, Err("no calendar".into())), Ok(()));
        assert_eq!(answer.try_recv(), Ok(Err("no calendar".into())));
    }
}

/// What a plugin can reach on the disk: its own folder, and nothing else.
mod files {
    use planner_lib::plugins::serving::within;
    use std::fs;
    use std::path::PathBuf;

    /// A plugin folder with a secret next to it, the way `~/.planner` has
    /// `config.toml` a level above every plugin.
    fn planted() -> PathBuf {
        let home = std::env::temp_dir().join(format!("planner-plugin-files-{}", std::process::id()));
        let plugin = home.join("plugins").join("example");
        fs::create_dir_all(&plugin).expect("make the plugin folder");
        fs::write(plugin.join("index.js"), "// the plugin's own").expect("write the entry");
        fs::write(home.join("config.toml"), "secret = true").expect("write the config");
        plugin
    }

    #[test]
    fn its_own_files_are_reachable() {
        let plugin = planted();
        assert!(within(&plugin, "index.js").is_ok());
        assert!(within(&plugin, "./index.js").is_ok());
    }

    #[test]
    fn nothing_above_its_folder_is() {
        let plugin = planted();

        for path in [
            "../../config.toml",
            "../../../etc/hosts",
            "./../../config.toml",
            "..//../config.toml",
            "sub/../../../config.toml",
        ] {
            let reached = within(&plugin, path);
            assert!(reached.is_err(), "{path} reached {reached:?}");
        }
    }

    #[test]
    fn an_absolute_path_does_not_escape_either() {
        let plugin = planted();
        // `join` with an absolute path replaces the root outright, which is
        // exactly the trap: without the check this reads /etc/hosts.
        assert!(within(&plugin, "/etc/hosts").is_err());
    }

    #[test]
    fn a_symlink_pointing_out_is_followed_and_then_refused() {
        let plugin = planted();
        let link = plugin.join("escape");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(plugin.join("..").join(".."), &link).expect("make the symlink");

        // The text says `escape/config.toml`, which climbs nowhere. Resolving
        // it first is what makes the answer no.
        assert!(within(&plugin, "escape/config.toml").is_err());
    }

    #[test]
    fn a_file_that_is_not_there_is_not_reachable() {
        assert!(within(&planted(), "nothing.js").is_err());
    }
}

/// Where a webview may go. `connect-src 'none'` says nothing about
/// navigation, so this is what keeps a plugin's reading on this machine.
mod navigation {
    use planner_lib::plugins::{app_navigable, navigable};
    use tauri::Url;

    fn url(text: &str) -> Url {
        Url::parse(text).expect("a URL")
    }

    #[test]
    fn a_plugin_may_load_its_own_files() {
        assert!(navigable("ticket-links", &url("plugin://ticket-links/index.html")));
        assert!(navigable("ticket-links", &url("plugin://ticket-links/")));
        assert!(navigable("ticket-links", &url("plugin://ticket-links/sub/thing.js#top")));
    }

    #[test]
    fn a_plugin_may_not_leave_the_machine() {
        for target in [
            "https://evil.example/?d=c2Vlbg",
            "http://127.0.0.1:9/",
            "data:text/html,<script>1</script>",
            "about:blank",
            "file:///etc/hosts",
            "tauri://localhost/index.html",
        ] {
            assert!(!navigable("ticket-links", &url(target)), "{target} was allowed");
        }
    }

    #[test]
    fn a_plugin_may_not_load_another_plugins_page() {
        // Same scheme, someone else's origin: the plugin folder is the unit
        // of trust, and reading another plugin's page would cross it.
        assert!(!navigable("ticket-links", &url("plugin://macos-calendar/index.html")));
        // Host comparison is exact. `plugin` is not a special scheme, so the
        // parser leaves the case alone rather than folding it for us.
        assert!(!navigable("ticket-links", &url("plugin://TICKET-LINKS/index.html")));
    }

    #[test]
    fn the_apps_own_windows_stay_on_their_own_origin() {
        assert!(app_navigable(&url("tauri://localhost/index.html")));
        assert!(app_navigable(&url("tauri://localhost/spread.html")));

        for target in [
            "https://example.com/",
            "plugin://ticket-links/index.html",
            "tauri://elsewhere/index.html",
            "about:blank",
        ] {
            assert!(!app_navigable(&url(target)), "{target} was allowed");
        }
    }
}

/// A judgement about somebody's code is not cleared by starting it again.
///
/// It matters from this commit on: a plugin put away now has its webview
/// closed, so its label leaves the window map, so `host::start`'s early
/// return no longer stands between a second start and a fresh grant.
#[test]
fn starting_a_plugin_again_does_not_forgive_it() {
    let registry = granted();
    registry.disable("macos-calendar", "did not answer within 2s");

    registry.grant(Granting {
        name: "macos-calendar".into(),
        entry: "index.js".into(),
        slots: vec!["vault.contribute".into()],
        capabilities: vec!["macos.calendar.read".into()],
        asked: vec!["macos.calendar.read".into()],
        ..Default::default()
    });

    assert!(registry.disabled("macos-calendar"), "a put-away plugin was let back in");
    assert!(!registry.permits("macos-calendar", "macos.calendar.read"));
}

#[test]
fn strikes_survive_a_second_grant_too() {
    let registry = granted();
    assert!(!registry.strike("macos-calendar"));
    assert!(!registry.strike("macos-calendar"));

    registry.grant(Granting {
        name: "macos-calendar".into(),
        entry: "index.js".into(),
        ..Default::default()
    });

    // The third strike is still the third, not the first of a new three.
    assert!(registry.strike("macos-calendar"));
    assert!(registry.disabled("macos-calendar"));
}

/// What may come up through the door in one message.
mod size {
    use planner_lib::plugins::door::{too_large, LIMIT};
    use serde_json::{json, Value};

    #[test]
    fn an_ordinary_answer_fits() {
        assert!(!too_large(&json!({ "kind": "ready" })));
        assert!(!too_large(&json!({
            "kind": "reply",
            "id": 3,
            "value": [{ "date": "2026-09-02", "time": "09:30", "text": "Standup" }],
        })));
    }

    #[test]
    fn a_megabyte_of_it_does_not() {
        let big = Value::from("x".repeat(LIMIT));
        assert!(too_large(&json!({ "kind": "reply", "id": 3, "value": big })));
    }

    /// The cap is on the message, not on one field: a thousand strings of a
    /// thousand characters is the same megabyte spelled differently.
    #[test]
    fn the_cap_is_on_the_whole_message() {
        let many: Vec<Value> = (0..2000).map(|_| Value::from("y".repeat(1000))).collect();
        assert!(too_large(&json!({ "kind": "reply", "id": 3, "value": many })));
    }
}

/// One capability call at a time, per plugin.
mod in_flight {
    use planner_lib::plugins::door::InFlight;

    #[test]
    fn a_second_call_from_the_same_plugin_finds_the_slot_taken() {
        let flight = InFlight::default();

        assert!(flight.enter("macos-calendar"));
        assert!(!flight.enter("macos-calendar"), "two calls were let through at once");

        flight.leave("macos-calendar");
        assert!(flight.enter("macos-calendar"), "the slot was not given back");
    }

    #[test]
    fn one_plugin_does_not_hold_the_slot_of_another() {
        let flight = InFlight::default();
        assert!(flight.enter("macos-calendar"));
        assert!(flight.enter("ticket-links"));
    }

    /// Leaving a slot nobody took is what a refused call does on its way out
    /// of an error branch. It must not open a door for somebody else.
    #[test]
    fn leaving_a_slot_that_was_never_taken_is_harmless() {
        let flight = InFlight::default();
        flight.leave("macos-calendar");
        assert!(flight.enter("macos-calendar"));
    }

    /// The whole reason the slot is held by a guard. A statement after the
    /// call does not run when the future around it is dropped, and a plugin
    /// whose slot was never given back could never use a capability again.
    #[test]
    fn a_dropped_call_gives_its_slot_back() {
        let flight = InFlight::default();

        {
            let held = flight.hold("macos-calendar");
            assert!(held.is_some());
            assert!(flight.hold("macos-calendar").is_none(), "two at once");
        }

        assert!(flight.hold("macos-calendar").is_some(), "the slot never came back");
    }
}

mod slots {
    use planner_lib::plugins::registry::Granting;
    use planner_lib::plugins::Registry;

    fn started() -> Registry {
        let registry = Registry::default();
        registry.grant(Granting {
        name: "ticket-links".into(),
        entry: "index.js".into(),
        slots: vec!["item.badge".into()],
        capabilities: vec!["shell.open".into()],
        asked: vec!["shell.open".into()],
        ..Default::default()
    });
        registry.grant(Granting {
        name: "macos-calendar".into(),
        entry: "index.js".into(),
        slots: vec!["vault.contribute".into()],
        capabilities: vec!["macos.calendar.read".into()],
        asked: vec!["macos.calendar.read".into()],
        ..Default::default()
    });
        registry
    }

    #[test]
    fn a_plugin_is_asked_only_what_it_was_granted() {
        let registry = started();
        assert_eq!(registry.running_for("item.badge"), vec!["ticket-links"]);
        assert_eq!(registry.running_for("vault.contribute"), vec!["macos-calendar"]);
        assert!(registry.running_for("theme.tokens").is_empty());
    }

    #[test]
    fn a_plugin_put_away_is_asked_nothing() {
        let registry = started();
        registry.disable("ticket-links", "did not answer within 2s");
        assert!(registry.running_for("item.badge").is_empty());
    }

    #[test]
    fn the_plugins_for_a_slot_come_back_in_a_settled_order() {
        let registry = Registry::default();
        for name in ["zulu", "alpha", "mike"] {
            registry.grant(Granting {
        name: name.into(),
        entry: "index.js".into(),
        slots: vec!["item.badge".into()],
        ..Default::default()
    });
        }
        assert_eq!(registry.running_for("item.badge"), vec!["alpha", "mike", "zulu"]);
    }

    #[test]
    fn a_slot_declared_and_never_handled_is_worth_saying() {
        let registry = started();
        // What the page reported when it had finished loading.
        registry.registered("ticket-links", vec!["vault.contribute".into()]);

        // Declared item.badge, handles vault.contribute: neither list is the
        // other, and both halves are worth a line.
        assert_eq!(registry.unhandled("ticket-links"), vec!["item.badge".to_string()]);
    }

    #[test]
    fn a_plugin_that_handles_what_it_declared_says_nothing() {
        let registry = started();
        registry.registered("ticket-links", vec!["item.badge".into()]);
        assert!(registry.unhandled("ticket-links").is_empty());
    }

    #[test]
    fn a_handler_for_a_slot_that_was_never_granted_is_never_asked() {
        let registry = started();
        registry.registered("ticket-links", vec!["item.badge".into(), "vault.contribute".into()]);
        // Registering is not granting. The grant is the only thing
        // `running_for` reads.
        assert!(registry.running_for("vault.contribute").iter().all(|one| one != "ticket-links"));
    }
}

mod asking {
    use planner_lib::plugins::waiting::envelope;
    use serde_json::json;

    #[test]
    fn a_question_names_its_slot_and_carries_the_time() {
        let asked = envelope(
            11,
            "item.badge",
            &json!({"date": "2026-09-02", "time": "16:20"}),
            &json!({"date": "2026-09-02", "items": []}),
        );
        assert_eq!(asked["id"], 11);
        assert_eq!(asked["kind"], "item.badge");
        assert_eq!(asked["now"]["time"], "16:20");
        assert_eq!(asked["date"], "2026-09-02");
    }

    #[test]
    fn params_cannot_forge_the_id_the_kind_or_the_time() {
        // `params` reaches here from the app's own window, but the three keys
        // the host owns are written last on purpose: an id a plugin could
        // choose is an answer it could put in somebody else's mouth.
        let asked = envelope(
            2,
            "vault.contribute",
            &json!({"date": "2026-09-02", "time": "09:00"}),
            &json!({"id": 999, "kind": "capability", "now": "nonsense"}),
        );
        assert_eq!(asked["id"], 2);
        assert_eq!(asked["kind"], "vault.contribute");
        assert_eq!(asked["now"]["date"], "2026-09-02");
    }

    #[test]
    fn params_that_are_not_a_table_are_simply_left_out() {
        let asked = envelope(1, "item.badge", &json!({"date": "d", "time": "t"}), &json!([1, 2]));
        assert_eq!(asked["kind"], "item.badge");
        assert!(asked.get("0").is_none());
    }
}
