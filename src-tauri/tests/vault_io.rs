//! The vault on disk: where a page lives, what counts as one, and the
//! promise that a write either lands whole or changes nothing.
//!
//! An integration test rather than a `mod tests` block, so vault_io.rs
//! stays inside the 300-line rule and these run against the same public
//! surface the rest of the shell uses.

use std::fs;
use std::path::{Path, PathBuf};
use planner_lib::vault_io::{
    canonical_root, path_for_page, page_for_path, read_all, read_page, write_page, Echoes,
    SOMEDAY,
};
use std::sync::atomic::{AtomicU32, Ordering};

/// A directory of its own per test, so they can run in parallel.
fn scratch(label: &str) -> PathBuf {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("planner-{label}-{unique}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

#[test]
fn a_page_maps_to_its_path_and_back() {
    let root = Path::new("/vault");
    for page in ["2026-08-31", "2024-02-29", SOMEDAY] {
        let path = path_for_page(root, page);
        assert_eq!(page_for_path(root, &path).as_deref(), Some(page), "{page}");
    }
}

#[test]
fn a_day_lives_under_its_year_and_month() {
    assert_eq!(
        path_for_page(Path::new("/vault"), "2026-08-31"),
        Path::new("/vault/2026/08/2026-08-31.md")
    );
    assert_eq!(path_for_page(Path::new("/vault"), SOMEDAY), Path::new("/vault/someday.md"));
}

#[test]
fn anything_else_in_the_vault_is_not_a_page() {
    let root = Path::new("/vault");
    for path in [
        "/vault/README.md",
        "/vault/2026/08/notes.md",
        "/vault/2026/08/2026-08-31.txt",
        "/vault/2026/2026-08-31.md",
        "/vault/a/2026/08/2026-08-31.md",
        "/vault/someday.md.bak",
    ] {
        assert_eq!(page_for_path(root, Path::new(path)), None, "{path}");
    }
}

// One date with two homes would mean writes landing in whichever the
// caller happened to compute.
#[test]
fn a_day_filed_under_the_wrong_month_is_not_a_page() {
    let root = Path::new("/vault");
    assert_eq!(page_for_path(root, Path::new("/vault/2026/09/2026-08-31.md")), None);
    assert_eq!(page_for_path(root, Path::new("/vault/2025/08/2026-08-31.md")), None);
}

#[test]
fn writing_a_page_creates_the_folders_it_needs() {
    let root = scratch("write");
    write_page(&root, "2026-08-31", "# 2026-08-31\n").expect("write");
    assert_eq!(
        fs::read_to_string(root.join("2026/08/2026-08-31.md")).unwrap(),
        "# 2026-08-31\n"
    );
}

#[test]
fn writing_leaves_no_temporary_file_behind() {
    let root = scratch("temp");
    write_page(&root, SOMEDAY, "# Someday\n").expect("write");

    let leftovers: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name != "someday.md")
        .collect();
    assert!(leftovers.is_empty(), "left behind: {leftovers:?}");
}

#[test]
fn writing_over_a_page_replaces_it_whole() {
    let root = scratch("replace");
    write_page(&root, SOMEDAY, "# Someday\n\n- [ ] One\n- [ ] Two\n").expect("first");
    write_page(&root, SOMEDAY, "# Someday\n").expect("second");
    assert_eq!(read_page(&root, SOMEDAY).unwrap(), "# Someday\n");
}

#[test]
fn reading_the_vault_finds_pages_and_ignores_the_rest() {
    let root = scratch("read-all");
    write_page(&root, "2026-08-31", "# 2026-08-31\n").expect("day");
    write_page(&root, "2026-09-01", "# 2026-09-01\n").expect("next day");
    write_page(&root, SOMEDAY, "# Someday\n").expect("back page");
    fs::write(root.join("README.md"), "not a page").expect("stray file");
    fs::create_dir_all(root.join("2026/08/nested")).expect("stray dir");

    let mut pages: Vec<String> = read_all(&root).into_iter().map(|file| file.page).collect();
    pages.sort();
    assert_eq!(pages, vec!["2026-08-31", "2026-09-01", "someday"]);
}

// The watcher's paths are canonical. A root that is not gets compared
// against them and never matches.
#[test]
fn a_root_reached_through_a_symlink_resolves_to_the_real_one() {
    let real = scratch("canonical");
    let link = std::env::temp_dir().join(format!("planner-link-{}", real.file_name().unwrap().to_string_lossy()));
    let _ = fs::remove_file(&link);
    std::os::unix::fs::symlink(&real, &link).expect("symlink");

    assert_eq!(canonical_root(&link), fs::canonicalize(&real).unwrap());
    let _ = fs::remove_file(&link);
}

#[test]
fn a_root_that_is_not_there_is_left_as_it_was_given() {
    let missing = Path::new("/nowhere/at/all");
    assert_eq!(canonical_root(missing), missing);
}

#[test]
fn a_missing_vault_reads_as_empty() {
    assert!(read_all(Path::new("/nowhere/at/all")).is_empty());
}

// The app announces its own writes itself, so the watcher must recognise
// the same content arriving moments later and stay quiet about it.
#[test]
fn a_write_is_recognised_as_its_own_echo() {
    let mut echoes = Echoes::default();
    echoes.record("2026-08-31", "# 2026-08-31\n");
    assert!(echoes.is_echo("2026-08-31", "# 2026-08-31\n"));
}

// One save reaches the watcher as several filesystem events. Every one of
// them is the same echo, and recognising only the first would report the
// app's own write as an edit made somewhere else.
#[test]
fn every_event_from_one_write_is_the_same_echo() {
    let mut echoes = Echoes::default();
    echoes.record("2026-08-31", "same\n");
    assert!(echoes.is_echo("2026-08-31", "same\n"));
    assert!(echoes.is_echo("2026-08-31", "same\n"));
    assert!(echoes.is_echo("2026-08-31", "same\n"));
}

// An edit made elsewhere changes the bytes, and different bytes are never an
// echo however recently the app wrote to that page.
#[test]
fn a_later_edit_is_heard_over_the_echo() {
    let mut echoes = Echoes::default();
    echoes.record("2026-08-31", "ours\n");
    assert!(!echoes.is_echo("2026-08-31", "nvim's\n"));
    echoes.record("2026-08-31", "ours again\n");
    assert!(!echoes.is_echo("2026-08-31", "ours\n"));
}

#[test]
fn different_content_is_never_an_echo() {
    let mut echoes = Echoes::default();
    echoes.record("2026-08-31", "what we wrote\n");
    assert!(!echoes.is_echo("2026-08-31", "what nvim wrote\n"));
}

#[test]
fn an_echo_belongs_to_one_page_only() {
    let mut echoes = Echoes::default();
    echoes.record("2026-08-31", "shared text\n");
    assert!(!echoes.is_echo("2026-09-01", "shared text\n"));
}
