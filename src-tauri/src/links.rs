//! An address somebody typed into their own note, handed to macOS (spec §2.3).
//!
//! Not `plugins::opening`, and the difference is who wrote the URL down. That
//! one checks a plugin's address against the prefixes the ⌘, pane approved
//! for it, because a plugin's output is somebody else's code reaching the
//! network. This is the vault's owner writing in the vault: there is nothing
//! to approve it against, and that list exists to constrain plugins rather
//! than the person whose notes these are.
//!
//! The scheme is still checked here, and not only in the frontend. A note is
//! a file anything can be pasted into, and `open` will happily hand a `file:`
//! or a `x-apple-…:` URL to whatever claims it - so the three schemes the
//! note view is willing to draw as a link are the three this will open.

use tauri::Url;

/// Opens an address from a note in whatever macOS uses for it.
///
/// Handed to `open` as one argument and never as a shell line: whatever is in
/// the URL is data, and `sh -lc` would make it a program. The same rule
/// `plugins::opening` follows, for the same reason.
#[tauri::command]
pub fn open_link(url: String) -> Result<(), String> {
    let target = Url::parse(&url).map_err(|_| format!("{url} is not an address"))?;

    if !matches!(target.scheme(), "http" | "https" | "mailto") {
        eprintln!("planner: refused to open {url}");
        return Err(format!("{url} is not an address this app will open"));
    }

    std::process::Command::new("open")
        .arg(target.as_str())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not open {url}: {error}"))
}
