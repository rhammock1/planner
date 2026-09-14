//! The folder a plugin owns in the vault: which names may have one, which
//! files may sit in it, and the promise that neither can reach past it
//! (design §2.5).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use planner_lib::vault_io::folders::{folder_path, is_file, is_folder, read, write};

fn scratch(label: &str) -> PathBuf {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("planner-{label}-{unique}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

#[test]
fn an_ordinary_plugin_name_is_a_folder() {
    for name in ["kanban", "macos-calendar", "a", "pet2", "a-plugin-with-2-digits"] {
        assert!(is_folder(name), "{name}");
    }
}

// The same rule `vaultFolder` keeps in `src/core/plugins.js`. The two are one
// rule said twice, so a name the frontend allows and this refuses would be a
// plugin with a slot it cannot use and no word about why.
#[test]
fn a_name_that_is_not_a_folder_is_refused() {
    for name in [
        "",
        "2026",          // a year folder, which `collect` would walk into
        "Kanban",        // the same folder twice on a case-folding disk
        "kan ban",
        "kan_ban",
        "kan.ban",
        "kan/ban",
        "../escape",
        ".hidden",
        "someday",       // the back page already has this name
    ] {
        assert!(!is_folder(name), "{name}");
    }
}

#[test]
fn a_name_longer_than_sixty_four_is_not_a_folder() {
    assert!(is_folder(&"a".repeat(64)));
    assert!(!is_folder(&"a".repeat(65)));
}

#[test]
fn a_file_in_the_folder_keeps_the_same_shape_of_name() {
    for file in ["board", "archive", "board-2026"] {
        assert!(is_file(file), "{file}");
    }
    for file in ["", "Board", "board.md", "../board", "board/x", "-board", "board-"] {
        assert!(!is_file(file), "{file}");
    }
}

#[test]
fn a_plugins_file_lives_under_its_own_name() {
    assert_eq!(
        folder_path(Path::new("/vault"), "kanban", "board"),
        Some(PathBuf::from("/vault/kanban/board.md"))
    );
}

// The one that matters: this function is what stands between a name and a
// path, so a name that could name a file outside the folder has to come back
// as no path at all rather than as a path somebody then writes to.
#[test]
fn a_name_that_could_leave_the_folder_has_no_path() {
    let root = Path::new("/vault");
    assert_eq!(folder_path(root, "../elsewhere", "board"), None);
    assert_eq!(folder_path(root, "kanban", "../../someday"), None);
    assert_eq!(folder_path(root, "kanban", "2026/08/2026-08-31"), None);
    assert_eq!(folder_path(root, "someday", "board"), None);
}

#[test]
fn a_file_that_is_not_there_reads_as_none() {
    let root = scratch("folder-missing");
    assert_eq!(read(&root, "kanban", "board"), None);
}

#[test]
fn an_empty_file_is_not_a_missing_one() {
    let root = scratch("folder-empty");
    write(&root, "kanban", "board", "").expect("write");
    assert_eq!(read(&root, "kanban", "board"), Some(String::new()));
}

#[test]
fn writing_a_plugins_file_creates_the_folder_it_needs() {
    let root = scratch("folder-write");
    write(&root, "kanban", "board", "## To do\n- A ^k4m2qa\n").expect("write");
    assert_eq!(
        fs::read_to_string(root.join("kanban/board.md")).unwrap(),
        "## To do\n- A ^k4m2qa\n"
    );
    assert_eq!(read(&root, "kanban", "board"), Some("## To do\n- A ^k4m2qa\n".into()));
}

#[test]
fn two_files_in_one_folder_are_two_files() {
    let root = scratch("folder-two");
    write(&root, "kanban", "board", "the board\n").expect("board");
    write(&root, "kanban", "archive", "the archive\n").expect("archive");
    assert_eq!(read(&root, "kanban", "board"), Some("the board\n".into()));
    assert_eq!(read(&root, "kanban", "archive"), Some("the archive\n".into()));
}

#[test]
fn writing_over_a_plugins_file_replaces_it_whole() {
    let root = scratch("folder-replace");
    write(&root, "kanban", "board", "## To do\n- A ^k4m2qa\n- B ^p7n3xd\n").expect("first");
    write(&root, "kanban", "board", "## To do\n").expect("second");
    assert_eq!(read(&root, "kanban", "board"), Some("## To do\n".into()));
}

// The atomic write leaves its temporary file nowhere, the same way a page's
// does - a `.board.md.tmp` sitting in the vault is a file somebody would open.
#[test]
fn writing_leaves_no_temporary_file_behind() {
    let root = scratch("folder-temp");
    write(&root, "kanban", "board", "## To do\n").expect("write");

    let leftovers: Vec<_> = fs::read_dir(root.join("kanban"))
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name != "board.md")
        .collect();
    assert!(leftovers.is_empty(), "left behind: {leftovers:?}");
}

#[test]
fn a_write_to_a_name_that_is_not_a_folder_is_refused_rather_than_placed() {
    let root = scratch("folder-refuse");
    assert!(write(&root, "../escape", "board", "no").is_err());
    assert!(write(&root, "kanban", "../../someday", "no").is_err());
    assert!(write(&root, "2026", "board", "no").is_err());

    // Nothing was created on the way to being refused.
    assert_eq!(fs::read_dir(&root).unwrap().flatten().count(), 0);
}
