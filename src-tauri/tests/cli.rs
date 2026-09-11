//! The command line (spec §1).

use std::fs;
use std::path::{Path, PathBuf};

use planner_lib::cli::{read, Intent};

/// A folder of its own per test, in the system temporary directory.
fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("planner-cli-{name}"));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("could not make a folder");
    // Canonicalized, because `read` canonicalizes the parent it returns and
    // /tmp is a symlink to /private/tmp on macOS.
    fs::canonicalize(&root).expect("could not resolve the folder")
}

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|one| (*one).to_string()).collect()
}

#[test]
fn nothing_at_all_means_todays_page() {
    assert_eq!(read(&[], Path::new("/"), None), Intent::Today);
}

#[test]
fn the_two_flags_are_answered() {
    assert_eq!(read(&args(&["--help"]), Path::new("/"), None), Intent::Help);
    assert_eq!(read(&args(&["-h"]), Path::new("/"), None), Intent::Help);
    assert_eq!(read(&args(&["--version"]), Path::new("/"), None), Intent::Version);
    assert_eq!(read(&args(&["-V"]), Path::new("/"), None), Intent::Version);
}

/// LaunchServices passes this to a bundled app on some versions of macOS. It
/// is not a path and it is not a refusal; it is nothing, and a double-clicked
/// Planner.app must not open its own usage message.
#[test]
fn the_process_serial_number_finder_passes_is_ignored() {
    assert_eq!(read(&args(&["-psn_0_1234567"]), Path::new("/"), None), Intent::Today);
}

#[test]
fn an_absolute_path_is_taken_as_it_is() {
    let root = folder("absolute");
    let asked = root.join("campaign.md");
    assert_eq!(read(&args(&[asked.to_str().unwrap()]), Path::new("/"), None), Intent::File(asked));
}

#[test]
fn a_relative_path_is_resolved_against_the_working_directory() {
    let root = folder("relative");
    assert_eq!(
        read(&args(&["campaign.md"]), &root, None),
        Intent::File(root.join("campaign.md")),
    );
}

#[test]
fn a_leading_tilde_is_resolved_against_home() {
    let root = folder("tilde");
    assert_eq!(
        read(&args(&["~/campaign.md"]), Path::new("/"), Some(&root)),
        Intent::File(root.join("campaign.md")),
    );
}

/// The whole reason the parent is canonicalized rather than the path: the
/// watcher reports canonical paths, and a vault reached through a symlink
/// would otherwise never match.
#[test]
fn the_folder_is_resolved_even_when_the_file_is_not_there_yet() {
    let root = folder("symlink");
    let real = root.join("real");
    fs::create_dir_all(&real).unwrap();
    let link = root.join("link");
    std::os::unix::fs::symlink(&real, &link).unwrap();

    assert_eq!(
        read(&args(&[link.join("new.md").to_str().unwrap()]), Path::new("/"), None),
        Intent::File(real.join("new.md")),
    );
}

/// A file that is not there yet is the ordinary case, not an error: it opens
/// blank and is created by the first write (spec §1.2, rule 4).
#[test]
fn a_file_that_does_not_exist_yet_is_accepted() {
    let root = folder("missing-file");
    assert!(matches!(read(&args(&["new.md"]), &root, None), Intent::File(_)));
}

#[test]
fn a_path_that_is_not_markdown_is_refused() {
    let root = folder("not-markdown");
    assert!(matches!(read(&args(&["notes.txt"]), &root, None), Intent::Refused(_)));
    assert!(matches!(read(&args(&["notes"]), &root, None), Intent::Refused(_)));
}

/// The rule that turns a typo into a refusal rather than a blank editor over
/// a file that springs into being at the first keystroke (spec §1.2, rule 2).
#[test]
fn a_folder_that_is_not_there_is_refused() {
    let root = folder("no-parent");
    let asked = root.join("nowhere").join("campaign.md");
    assert!(matches!(read(&args(&[asked.to_str().unwrap()]), Path::new("/"), None), Intent::Refused(_)));
}

#[test]
fn a_folder_named_like_a_file_is_refused() {
    let root = folder("folder-named-md");
    fs::create_dir_all(root.join("campaign.md")).unwrap();
    assert!(matches!(read(&args(&["campaign.md"]), &root, None), Intent::Refused(_)));
}

#[test]
fn an_option_this_app_does_not_have_is_refused() {
    assert!(matches!(read(&args(&["--wat"]), Path::new("/"), None), Intent::Refused(_)));
}

#[test]
fn two_paths_are_refused_rather_than_one_of_them_chosen() {
    let root = folder("two-paths");
    assert!(matches!(read(&args(&["a.md", "b.md"]), &root, None), Intent::Refused(_)));
}
