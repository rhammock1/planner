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

/// Files beside a day. Its own module because the rule has four parts and
/// this file is already at its length (spec §4.1).
pub mod sidecars;

/// The folder a plugin may own in the vault (spec §2.5). Its own module for
/// the same reason, and beside sidecars because it is the other answer to
/// "where does a file that is not a day go".
pub mod folders;

/// The back page's key. A date names every other page.
pub const SOMEDAY: &str = "someday";

#[derive(Serialize, Clone)]
pub struct PageFile {
    pub page: String,
    pub text: String,
}

/// What was last written to a file, so the watcher can recognise its own echo.
///
/// Keyed by path rather than by page. A day and its sidecars share a date and
/// are different files, so a page key would have a sidecar's write silence a
/// real edit to the day it sits beside (spec §4.1).
#[derive(Default)]
pub struct Echoes(HashMap<PathBuf, u64>);

impl Echoes {
    pub fn record(&mut self, path: &Path, text: &str) {
        self.0.insert(path.to_path_buf(), digest(text));
    }

    /// True when this content is what we last wrote to that file.
    ///
    /// The record is kept rather than consumed, because one save does not
    /// arrive as one event: FSEvents reports a create and two modifies for a
    /// single write, and consuming the record would let all but the first
    /// through as somebody else's edit.
    ///
    /// The cost is that an external write of byte-identical content is
    /// suppressed too. That costs nothing to see, because the page on screen
    /// already says exactly that. A record only stops being an echo when the
    /// content differs from it - which is what a real edit does.
    pub fn is_echo(&self, path: &Path, text: &str) -> bool {
        self.0.get(path) == Some(&digest(text))
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

pub(crate) fn is_date(text: &str) -> bool {
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

/// Writes a page atomically. See `write_atomic`.
pub fn write_page(root: &Path, page: &str, text: &str) -> std::io::Result<()> {
    write_atomic(&path_for_page(root, page), text)
}

/// Writes a file atomically: a temporary file in the same directory, flushed,
/// then renamed over the target. A rename within one filesystem is atomic, so
/// a crash or a full disk leaves the previous file exactly as it was - which
/// is the whole of spec §8's promise that a failed write destroys nothing.
///
/// Shared by a page and a sidecar, because the promise is about the vault and
/// not about which of the two kinds of file is being written.
pub fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "that file has no directory")
    })?;
    fs::create_dir_all(parent)?;

    let temporary = parent.join(format!(".{}.tmp", file_name(path)));
    {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
    }

    match fs::rename(&temporary, path) {
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

