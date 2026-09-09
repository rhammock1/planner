//! The sidecar rule, and the files under it (spec §4.1).

use std::fs;
use std::path::PathBuf;

use planner_lib::vault_io::sidecars;

/// A vault of its own per test, in the system temporary directory.
fn vault(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("planner-sidecars-{name}"));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("could not make a vault");
    root
}

#[test]
fn a_suffix_is_lowercase_words_joined_by_single_hyphens() {
    assert!(sidecars::is_suffix("meeting"));
    assert!(sidecars::is_suffix("meeting-standup"));
    assert!(sidecars::is_suffix("note-review-pr-4412"));
    assert!(sidecars::is_suffix(&"a".repeat(64)));
}

#[test]
fn a_suffix_that_could_name_something_else_is_refused() {
    assert!(!sidecars::is_suffix(""));
    assert!(!sidecars::is_suffix("Meeting"));
    assert!(!sidecars::is_suffix("-meeting"));
    assert!(!sidecars::is_suffix("meeting-"));
    assert!(!sidecars::is_suffix("meeting--standup"));
    assert!(!sidecars::is_suffix("meeting.standup"));
    assert!(!sidecars::is_suffix("meeting/standup"));
    assert!(!sidecars::is_suffix(".."));
    assert!(!sidecars::is_suffix(&"a".repeat(65)));
}

#[test]
fn a_sidecar_sits_in_the_day_folder_under_the_day_stem() {
    let root = vault("path");
    assert_eq!(
        sidecars::sidecar_path(&root, "2026-09-01", "meeting-standup"),
        Some(root.join("2026").join("09").join("2026-09-01.meeting-standup.md")),
    );
    assert_eq!(sidecars::sidecar_path(&root, "someday", "meeting"), None);
    assert_eq!(sidecars::sidecar_path(&root, "2026-09-01", "../escape"), None);
}

#[test]
fn a_written_sidecar_reads_back() {
    let root = vault("roundtrip");
    sidecars::write(&root, "2026-09-01", "meeting-standup", "# Standup\n\nback off\n")
        .expect("could not write");
    assert_eq!(
        sidecars::read(&root, "2026-09-01", "meeting-standup").as_deref(),
        Some("# Standup\n\nback off\n"),
    );
    assert_eq!(sidecars::read(&root, "2026-09-01", "meeting-other"), None);
}

#[test]
fn a_day_file_is_not_a_sidecar_and_a_sidecar_is_not_a_day() {
    let root = vault("shapes");
    let day = root.join("2026").join("09").join("2026-09-01.md");
    let side = root.join("2026").join("09").join("2026-09-01.meeting-standup.md");

    assert_eq!(planner_lib::vault_io::page_for_path(&root, &day), Some("2026-09-01".to_string()));
    // The property the whole phase stands on: the index never sees one.
    assert_eq!(planner_lib::vault_io::page_for_path(&root, &side), None);
    assert_eq!(sidecars::sidecar_for_path(&root, &day), None);
    assert_eq!(
        sidecars::sidecar_for_path(&root, &side),
        Some(("2026-09-01".to_string(), "meeting-standup".to_string())),
    );
}

#[test]
fn a_sidecar_filed_under_the_wrong_month_is_not_one() {
    let root = vault("misfiled");
    let wrong = root.join("2026").join("08").join("2026-09-01.meeting-standup.md");
    assert_eq!(sidecars::sidecar_for_path(&root, &wrong), None);
}

#[test]
fn listing_a_range_gives_back_the_days_inside_it_with_their_titles() {
    let root = vault("list");
    sidecars::write(&root, "2026-08-31", "meeting-retro", "# Retro\n").unwrap();
    sidecars::write(&root, "2026-09-01", "meeting-standup", "# Standup\n\nnotes\n").unwrap();
    sidecars::write(&root, "2026-09-02", "note-untitled", "no heading here\n").unwrap();
    sidecars::write(&root, "2026-10-05", "meeting-later", "# Later\n").unwrap();

    let found = sidecars::list(&root, "2026-08-31", "2026-09-02");
    let named: Vec<(String, String, String)> = found
        .iter()
        .map(|one| (one.date.clone(), one.suffix.clone(), one.title.clone()))
        .collect();

    assert_eq!(
        named,
        vec![
            ("2026-08-31".into(), "meeting-retro".into(), "Retro".into()),
            ("2026-09-01".into(), "meeting-standup".into(), "Standup".into()),
            // No `# ` line, so the suffix is the only name it has.
            ("2026-09-02".into(), "note-untitled".into(), "note-untitled".into()),
        ],
    );
}

#[test]
fn a_write_never_leaves_half_a_file() {
    let root = vault("atomic");
    sidecars::write(&root, "2026-09-01", "meeting-standup", "first\n").unwrap();
    sidecars::write(&root, "2026-09-01", "meeting-standup", "second\n").unwrap();

    // The temporary file the atomic write used is gone, so nothing in the
    // vault is a `.` file the user has to explain to themselves.
    let month = root.join("2026").join("09");
    let left: Vec<String> = fs::read_dir(&month)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(left, vec!["2026-09-01.meeting-standup.md".to_string()]);
}

#[test]
fn an_echo_is_about_a_file_rather_than_about_a_day() {
    use planner_lib::vault_io::Echoes;

    let root = vault("echoes");
    let day = root.join("2026").join("09").join("2026-09-01.md");
    let side = root.join("2026").join("09").join("2026-09-01.meeting-standup.md");

    let mut echoes = Echoes::default();
    echoes.record(&day, "- [ ] a line\n");

    assert!(echoes.is_echo(&day, "- [ ] a line\n"));
    // The day and its sidecar share a date and are two files. Before the key
    // moved to the path, writing one silenced a real edit to the other.
    assert!(!echoes.is_echo(&side, "- [ ] a line\n"));

    echoes.record(&side, "# Standup\n");
    assert!(echoes.is_echo(&side, "# Standup\n"));
    assert!(!echoes.is_echo(&side, "# Standup\n\nedited elsewhere\n"));
}

#[test]
fn a_plugin_is_shown_only_the_sidecars_its_prefixes_own() {
    let root = vault("scoped");
    sidecars::write(&root, "2026-09-01", "meeting-standup", "# Standup\n").unwrap();
    sidecars::write(&root, "2026-09-01", "note-review", "# Review\n").unwrap();

    let all = sidecars::list(&root, "2026-09-01", "2026-09-01");
    assert_eq!(all.len(), 2, "the app itself sees both");

    // The scoping is `owns`: the prefix itself, or the prefix and a hyphen.
    let mine: Vec<&sidecars::Sidecar> = all
        .iter()
        .filter(|one| planner_lib::bridges::sidecars::owned(&["meeting".to_string()], &one.suffix))
        .collect();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].suffix, "meeting-standup");

    assert!(!planner_lib::bridges::sidecars::owned(&["meeting".to_string()], "meetings-elsewhere"));
    assert!(planner_lib::bridges::sidecars::owned(&["meeting".to_string()], "meeting"));
}
