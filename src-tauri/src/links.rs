//! An address somebody typed into their own note, handed to macOS (spec §2.3).
//!
//! Not `plugins::opening`, and the difference is who wrote the URL down. That
//! one checks a plugin's address against the prefixes the ⌘, pane approved
//! for it, because a plugin's output is somebody else's code reaching the
//! network. This is the vault's owner writing in the vault: there is nothing
//! to approve it against, and that list exists to constrain plugins rather
//! than the person whose notes these are.
//!
//! Which is not the same as opening whatever it is handed. A note is a file
//! anything can be pasted into, so three things are checked here and not only
//! in the frontend: the scheme, because `open` will hand a `file:` or an
//! `x-apple-…:` URL to whatever claims it; the userinfo, because
//! `https://apple.com@evil.io/` reads as one host and resolves to another;
//! and a `mailto:`'s query, because that is where a compose window is told
//! what to attach.

use tauri::Url;

/// Opens an address from a note in whatever macOS uses for it.
///
/// Handed to `open` as one argument and never as a shell line: whatever is in
/// the URL is data, and `sh -lc` would make it a program. The same rule
/// `plugins::opening` follows, for the same reason.
#[tauri::command]
pub fn open_link(url: String) -> Result<(), String> {
    let mut target = Url::parse(&url).map_err(|_| format!("{url} is not an address"))?;

    if !matches!(target.scheme(), "http" | "https" | "mailto") {
        eprintln!("planner: refused to open {url}");
        return Err(format!("{url} is not an address this app will open"));
    }

    // A label that names one host and an address that resolves to another.
    // Refused the way `plugins::opening::within` already refuses it, so that
    // the app's own links and a plugin's are held to the one rule.
    if !target.username().is_empty() || target.password().is_some() {
        eprintln!("planner: refused to open {url}");
        return Err(format!("{url} carries a username, which this app will not open"));
    }

    // A `mailto:` may carry `?subject=`, `?body=` and `?attach=`, and the
    // last of those puts a local file into a compose window that nothing on
    // screen said anything about. The address is the part that was meant, so
    // the address is all that goes. Left alone for `http`, where the query is
    // usually most of the address.
    if target.scheme() == "mailto" {
        target.set_query(None);
        target.set_fragment(None);
    }

    std::process::Command::new("open")
        .arg(target.as_str())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not open {url}: {error}"))
}
