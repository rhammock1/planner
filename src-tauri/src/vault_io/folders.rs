//! A folder a plugin owns in the vault (spec §2.5).
//!
//! ```text
//! 2026/09/2026-09-01.md    a day
//! someday.md               the back page
//! kanban/board.md          a plugin's own file
//! kanban/archive.md
//! ```
//!
//! A plugin that keeps something bigger than a setting and smaller than the
//! vault keeps it here: a board, and its archive. The files are the person's,
//! in plain sight, next to the days they are about - which is why they live in
//! the vault at all rather than in `state/`, where `planner.storage` puts the
//! small things nobody is meant to open.
//!
//! The rule about the name is deliberately the one `vaultFolder` states in
//! `src/core/plugins.js`, and it is said again here for the reason
//! `bridges/storage.rs` says its own rule again: this function is what stands
//! between a name and a path. A name with a `/` or a `..` in it would name a
//! file outside the vault, and "the frontend already checked" is not a thing to
//! leave to the caller.
//!
//! Nothing here is watched. `page_for_path` refuses every path in a plugin's
//! folder, so `collect` never reads one as a day and the watcher never
//! announces one - which is what keeps a board out of the day view and out of
//! ⌘F. The cost is that a board edited in an editor while the window is open
//! is stale until the tab is drawn again, and a board is drawn from its file
//! every time it is drawn at all.

use std::fs;
use std::path::{Path, PathBuf};

use super::sidecars::is_suffix;

/// The longest a folder's name may be. Mirrors `VAULT_FOLDER` in
/// `src/core/plugins.js`.
pub const LONGEST_NAME: usize = 64;

/// The one name no plugin may have, because the back page already has it.
const RESERVED: &str = "someday";

/// Whether a plugin's name may be a folder in the vault.
///
/// A letter first, then lowercase letters, digits and hyphens. The leading
/// letter is the part that is not tidiness: a folder called `2026` *is* a year
/// folder, and `collect` would walk into it looking for months.
pub fn is_folder(name: &str) -> bool {
    if name.is_empty() || name.len() > LONGEST_NAME || name == RESERVED {
        return false;
    }
    let mut bytes = name.bytes();
    let Some(first) = bytes.next() else { return false };
    first.is_ascii_lowercase()
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Whether a name inside a plugin's folder may be a file.
///
/// The same rule a sidecar's suffix keeps, and deliberately the same function
/// rather than a second copy of it: both are a filename this app composes from
/// a string it was handed, and one rule for that is one place to be wrong.
pub fn is_file(file: &str) -> bool {
    is_suffix(file)
}

/// Where one of a plugin's files lives. `None` for anything that is not one -
/// which is what keeps a name from reaching a file outside the folder.
pub fn folder_path(root: &Path, name: &str, file: &str) -> Option<PathBuf> {
    if !is_folder(name) || !is_file(file) {
        return None;
    }
    Some(root.join(name).join(format!("{file}.md")))
}

/// One of a plugin's files, or `None` when it is not there - which is how a
/// board tells "no board yet" from "a board somebody emptied".
pub fn read(root: &Path, name: &str, file: &str) -> Option<String> {
    fs::read_to_string(folder_path(root, name, file)?).ok()
}

/// Writes one of a plugin's files, atomically, by the same route a page takes.
pub fn write(root: &Path, name: &str, file: &str, text: &str) -> std::io::Result<()> {
    let path = folder_path(root, name, file).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, not_a_file(name, file))
    })?;
    super::write_atomic(&path, text)
}

/// The sentence a caller gets for a name that cannot be a file.
///
/// One function, so the refusal reads the same wherever it is made.
pub fn not_a_file(name: &str, file: &str) -> String {
    format!("{name}/{file} is not a file a plugin may keep in the vault")
}
