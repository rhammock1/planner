//! A file opened by name (spec §2.2).

use std::fs;
use std::path::{Path, PathBuf};

use planner_lib::files;

fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("planner-files-{name}"));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("could not make a folder");
    fs::canonicalize(&root).expect("could not resolve the folder")
}

#[test]
fn markdown_is_what_this_app_will_open() {
    assert!(files::is_markdown(Path::new("/x/campaign.md")));
    assert!(files::is_markdown(Path::new("/x/CAMPAIGN.MD")));
    assert!(!files::is_markdown(Path::new("/x/campaign.txt")));
    assert!(!files::is_markdown(Path::new("/x/campaign")));
    assert!(!files::is_markdown(Path::new("/x/.md")));
}

#[test]
fn a_file_that_is_not_there_reads_as_nothing_rather_than_as_empty() {
    let root = folder("missing");
    assert_eq!(files::read(&root.join("nope.md")), None);
}

#[test]
fn a_file_that_is_there_reads_back_exactly() {
    let root = folder("read");
    let path = root.join("campaign.md");
    fs::write(&path, "# A Rumbling of Thunder\n").unwrap();
    assert_eq!(files::read(&path), Some("# A Rumbling of Thunder\n".to_string()));
}

#[test]
fn a_write_lands_whole_and_leaves_no_temporary_behind() {
    let root = folder("write");
    let path = root.join("campaign.md");
    files::write(&path, "# One\n").expect("the write should land");
    assert_eq!(fs::read_to_string(&path).unwrap(), "# One\n");

    files::write(&path, "# Two\n").expect("the second write should land");
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Two\n");

    let left: Vec<String> = fs::read_dir(&root)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(left, vec!["campaign.md".to_string()]);
}

/// Reachable only from the app's own windows, and refused anyway: a bug in
/// the frontend should not be able to write a `.plist`.
#[test]
fn nothing_but_markdown_is_read_or_written() {
    let root = folder("refused");
    let path = root.join("secrets.txt");
    fs::write(&path, "before").unwrap();

    assert_eq!(files::read(&path), None);
    assert!(files::write(&path, "after").is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "before");
}
