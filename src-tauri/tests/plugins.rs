//! The plugin sandbox's two rules: what a plugin window may call, and what a
//! plugin may reach once it has called it.

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
    registry.grant(
        "macos-calendar",
        "index.js".into(),
        vec!["macos.calendar.read".into()],
    );
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
    assert_eq!(registry.running(), vec!["macos-calendar".to_string()]);

    registry.disable("macos-calendar");

    assert!(registry.running().is_empty());
    assert!(!registry.permits("macos-calendar", "macos.calendar.read"));
}

#[test]
fn a_plugin_nobody_started_is_not_running() {
    assert!(Registry::default().running().is_empty());
    assert!(Registry::default().disabled("macos-calendar"));
}

#[test]
fn the_plugins_are_asked_in_a_settled_order() {
    let registry = Registry::default();
    for name in ["zeta", "alpha", "mu"] {
        registry.grant(name, "index.js".into(), Vec::new());
    }
    // Otherwise the section's lines would shuffle from launch to launch, for
    // no reason the reader could see.
    assert_eq!(registry.running(), vec!["alpha", "mu", "zeta"]);
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
    use planner_lib::plugins::host::within;
    use std::fs;
    use std::path::PathBuf;

    /// A plugin folder with a secret next to it, the way `~/.planner` has
    /// `config.toml` a level above every plugin.
    fn planted() -> PathBuf {
        let home = std::env::temp_dir().join(format!("planner-within-{}", std::process::id()));
        let plugin = home.join("plugins").join("probe");
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
