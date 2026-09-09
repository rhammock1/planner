//! A file beside a day (spec §4.1).
//!
//! ```text
//! 2026/09/2026-09-01.md                    the day
//! 2026/09/2026-09-01.meeting-standup.md    a sidecar
//! ```
//!
//! The rule is deliberately the same one `core/sidecars.js` states, because
//! the app names a sidecar in JavaScript and this writes it: two rules would
//! be two filenames, and the second would be the one nobody could find.
//!
//! Nothing here parses a sidecar. Its text is free text - never a day, never
//! an item, never a token - which is why `read` hands back a `String` and the
//! only thing this module ever looks *inside* a file for is its first heading,
//! so a listing has something to call it.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::is_date;

/// The longest a suffix may be. Mirrors `LONGEST_SUFFIX` in
/// `src/core/sidecars.js`.
pub const LONGEST_SUFFIX: usize = 64;

/// One sidecar, as a listing names it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Sidecar {
    pub date: String,
    pub suffix: String,
    /// The first `# ` line, or the suffix when there is none. A name to show,
    /// never a name to write with.
    pub title: String,
}

/// Lowercase words joined by single hyphens, and short enough to be a name.
pub fn is_suffix(suffix: &str) -> bool {
    if suffix.is_empty() || suffix.len() > LONGEST_SUFFIX {
        return false;
    }
    if suffix.starts_with('-') || suffix.ends_with('-') || suffix.contains("--") {
        return false;
    }
    suffix
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Where a sidecar lives. `None` for anything that is not one - which is what
/// keeps a suffix from naming a file outside the day's own folder.
pub fn sidecar_path(root: &Path, date: &str, suffix: &str) -> Option<PathBuf> {
    if !is_date(date) || !is_suffix(suffix) {
        return None;
    }
    Some(
        root.join(&date[0..4])
            .join(&date[5..7])
            .join(format!("{date}.{suffix}.md")),
    )
}

/// The day and suffix a path addresses, or `None` if the path is not a
/// sidecar.
///
/// A sidecar filed under folders that disagree with its date is refused, the
/// same way `page_for_path` refuses a day that is: one date with two homes
/// means writes landing in whichever the caller happened to compute.
pub fn sidecar_for_path(root: &Path, path: &Path) -> Option<(String, String)> {
    let relative = path.strip_prefix(root).ok()?;
    let name = relative.file_name()?.to_str()?;
    let stem = name.strip_suffix(".md")?;

    // `split_once`, not `rsplit_once`: the date comes first and a suffix may
    // never contain a dot, so the first one is the only one.
    let (date, suffix) = stem.split_once('.')?;
    if !is_date(date) || !is_suffix(suffix) {
        return None;
    }

    let mut parts = relative.parent()?.components().rev();
    let month = parts.next()?.as_os_str().to_str()?;
    let year = parts.next()?.as_os_str().to_str()?;
    if parts.next().is_some() || year != &date[0..4] || month != &date[5..7] {
        return None;
    }
    Some((date.to_string(), suffix.to_string()))
}

pub fn read(root: &Path, date: &str, suffix: &str) -> Option<String> {
    fs::read_to_string(sidecar_path(root, date, suffix)?).ok()
}

/// Writes a sidecar, atomically, by the same route a page takes.
pub fn write(root: &Path, date: &str, suffix: &str, text: &str) -> std::io::Result<()> {
    let path = sidecar_path(root, date, suffix).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{date}.{suffix} is not a sidecar's name"),
        )
    })?;
    super::write_atomic(&path, text)
}

/// Every sidecar between two dates, inclusive, in date then suffix order.
///
/// Reads each file it finds, because the title is the first line of it and a
/// listing with no titles would make the caller open all of them anyway. Two
/// months of notes is a few dozen small files; a provider searching sixty days
/// either side of today does this once per query rather than once per day.
pub fn list(root: &Path, from: &str, to: &str) -> Vec<Sidecar> {
    let mut found = Vec::new();
    if !is_date(from) || !is_date(to) || from > to {
        return found;
    }

    // Dates are `YYYY-MM-DD`, so string order is date order and a year or a
    // month folder can be skipped whole without any date arithmetic.
    let Ok(years) = fs::read_dir(root) else { return found };
    for year in years.flatten() {
        let Some(name) = year.file_name().to_str().map(str::to_string) else { continue };
        if name.len() != 4 || name.as_str() < &from[0..4] || name.as_str() > &to[0..4] {
            continue;
        }
        let Ok(months) = fs::read_dir(year.path()) else { continue };
        for month in months.flatten() {
            let Ok(days) = fs::read_dir(month.path()) else { continue };
            for day in days.flatten() {
                let path = day.path();
                let Some((date, suffix)) = sidecar_for_path(root, &path) else { continue };
                if date.as_str() < from || date.as_str() > to {
                    continue;
                }
                let text = fs::read_to_string(&path).unwrap_or_default();
                let title = title_of(&text, &suffix);
                found.push(Sidecar { date, suffix, title });
            }
        }
    }

    // Settled, so two launches list the same days in the same order and a
    // provider's results do not shuffle.
    found.sort_by(|left, right| {
        left.date.cmp(&right.date).then_with(|| left.suffix.cmp(&right.suffix))
    });
    found
}

/// The first `# ` line, or the suffix.
///
/// One line, cut: a title is drawn on the day page, and a file somebody else
/// wrote does not get to decide how much of the page it takes.
fn title_of(text: &str, suffix: &str) -> String {
    let heading = text
        .lines()
        .find_map(|line| line.strip_prefix("# "))
        .map(str::trim)
        .filter(|line| !line.is_empty());

    match heading {
        Some(line) if line.chars().count() <= 80 => line.to_string(),
        Some(line) => line.chars().take(79).collect::<String>() + "…",
        None => suffix.to_string(),
    }
}
