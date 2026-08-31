//! Reading and writing the vault: the only part of this app that touches the
//! user's files.
//!
//! Two rules govern everything here. A write is atomic, so a file is either
//! the old one or the new one and never a half-written one. And a change to
//! any page - made here or made in an editor - is announced the same way, so
//! the frontend has exactly one path by which the vault can change.

use std::collections::HashMap;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// The back page's key. A date names every other page.
pub const SOMEDAY: &str = "someday";

#[derive(Serialize, Clone)]
pub struct PageFile {
    pub page: String,
    pub text: String,
}

/// What was last written to a page, so the watcher can recognise its own echo.
#[derive(Default)]
pub struct Echoes(HashMap<String, u64>);

impl Echoes {
    pub fn record(&mut self, page: &str, text: &str) {
        self.0.insert(page.to_string(), digest(text));
    }

    /// True when this content is what we just wrote. The record is consumed:
    /// a second, genuinely external write of identical bytes is a real change
    /// and must not be swallowed by a stale entry.
    pub fn is_echo(&mut self, page: &str, text: &str) -> bool {
        match self.0.get(page) {
            Some(&recorded) if recorded == digest(text) => {
                self.0.remove(page);
                true
            }
            _ => false,
        }
    }
}

fn digest(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

/// The path a page lives at, relative to the vault root.
///
/// Mirrors `pathFor` in `src/core/vaultIndex.js`; the two must agree, which is
/// why both are one line over the same rule.
pub fn path_for_page(root: &Path, page: &str) -> PathBuf {
    if page == SOMEDAY {
        return root.join("someday.md");
    }
    root.join(&page[0..4]).join(&page[5..7]).join(format!("{page}.md"))
}

/// The page a path addresses, or None if the path is not a page.
///
/// A day filed under folders that disagree with its name is refused, the same
/// way `pageForPath` refuses it: one date with two homes means writes landing
/// in whichever the caller happened to compute.
pub fn page_for_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let name = relative.file_name()?.to_str()?;

    if relative.parent().map(|p| p.as_os_str().is_empty()).unwrap_or(false) {
        return (name == "someday.md").then(|| SOMEDAY.to_string());
    }

    let date = name.strip_suffix(".md")?;
    if !is_date(date) {
        return None;
    }

    let mut parts = relative.parent()?.components().rev();
    let month = parts.next()?.as_os_str().to_str()?;
    let year = parts.next()?.as_os_str().to_str()?;
    if parts.next().is_some() || year != &date[0..4] || month != &date[5..7] {
        return None;
    }
    Some(date.to_string())
}

fn is_date(text: &str) -> bool {
    text.len() == 10
        && text.as_bytes()[4] == b'-'
        && text.as_bytes()[7] == b'-'
        && text[0..4].bytes().all(|b| b.is_ascii_digit())
        && text[5..7].bytes().all(|b| b.is_ascii_digit())
        && text[8..10].bytes().all(|b| b.is_ascii_digit())
}

/// The vault root as the filesystem itself names it.
///
/// The watcher reports canonical paths, so a vault reached through a symlink -
/// `/tmp`, a synced folder, a home directory that is a link - would hand back
/// paths that never match the root it was given, and every edit made outside
/// the app would go unnoticed. Resolving the root once, here, is what keeps
/// the two comparable.
pub fn canonical_root(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Every page in the vault. A vault that is not there yet reads as empty
/// rather than as an error: the app opens, and says so in the page.
pub fn read_all(root: &Path) -> Vec<PageFile> {
    let mut pages = Vec::new();
    collect(root, root, &mut pages, 0);
    pages
}

fn collect(root: &Path, dir: &Path, pages: &mut Vec<PageFile>, depth: usize) {
    // year/month/day.md is as deep as the vault ever goes.
    if depth > 2 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, pages, depth + 1);
        } else if let Some(page) = page_for_path(root, &path) {
            if let Ok(text) = fs::read_to_string(&path) {
                pages.push(PageFile { page, text });
            }
        }
    }
}

pub fn read_page(root: &Path, page: &str) -> Option<String> {
    fs::read_to_string(path_for_page(root, page)).ok()
}

/// Writes a page atomically: a temporary file in the same directory, flushed,
/// then renamed over the target. A rename within one filesystem is atomic, so
/// a crash or a full disk leaves the previous file exactly as it was - which
/// is the whole of spec §8's promise that a failed write destroys nothing.
pub fn write_page(root: &Path, page: &str, text: &str) -> std::io::Result<()> {
    let path = path_for_page(root, page);
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "page has no directory")
    })?;
    fs::create_dir_all(parent)?;

    let temporary = parent.join(format!(".{}.tmp", file_name(&path)));
    {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
    }

    match fs::rename(&temporary, &path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("page.md")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn only_once_though() {
        let mut echoes = Echoes::default();
        echoes.record("2026-08-31", "same\n");
        assert!(echoes.is_echo("2026-08-31", "same\n"));
        // Someone else writing identical bytes later is a real change.
        assert!(!echoes.is_echo("2026-08-31", "same\n"));
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
}
