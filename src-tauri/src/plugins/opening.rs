//! `shell.open`: the one way a plugin's output leaves the machine.
//!
//! The scope is stated rather than implied: a badge can carry the text of a
//! line into a URL, and the URL goes to a host the person named in the ⌘,
//! pane. Nothing else about a plugin reaches the network.
//!
//! Both sides are parsed. A string-prefix check passes
//! `https://github.com.evil.io/…` and `https://github.com/org/repo/../evil/`,
//! and both of those leave the machine for somewhere nobody approved.

use tauri::{AppHandle, Manager, Url};

use super::Registry;

/// One entry of an approved list, if it is an address a plugin may be given.
///
/// `https:` or `http:`, no userinfo, and a trailing slash - without which
/// `…/gotab` would approve `…/gotabbing-elsewhere`.
///
/// No query and no fragment either. `within` compares scheme, host, port and
/// path segments, so `https://github.com/?a=/org/repo/pull/` would read on
/// the pane's checkbox as one repository's pull requests and approve every
/// address on the host. What is shown and what is enforced are the same
/// string only if the part that is never compared cannot be written down.
pub fn parse_prefix(entry: &str) -> Option<Url> {
    let url = Url::parse(entry).ok()?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    if url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    if !url.path().ends_with('/') {
        return None;
    }
    Some(url)
}

/// Whether a target falls under a prefix.
///
/// Scheme, host and port exactly; the path segment by segment. `Url` has
/// already resolved `..` and `.` by the time either of these is built, so the
/// only comparison left is the one that matters.
pub fn within(prefix: &Url, target: &Url) -> bool {
    if target.scheme() != prefix.scheme() {
        return false;
    }
    if !target.username().is_empty() || target.password().is_some() {
        return false;
    }
    if target.host_str() != prefix.host_str() {
        return false;
    }
    // The scheme's own port and the port written out are the same address.
    if target.port_or_known_default() != prefix.port_or_known_default() {
        return false;
    }

    let (Some(wanted), Some(under)) = (prefix.path_segments(), target.path_segments()) else {
        return false;
    };
    let wanted: Vec<&str> = wanted.filter(|step| !step.is_empty()).collect();
    let under: Vec<&str> = under.filter(|step| !step.is_empty()).collect();
    under.len() >= wanted.len() && wanted.iter().zip(under.iter()).all(|(one, two)| one == two)
}

/// Opens a URL a plugin asked the app to open, if the config approved it.
///
/// Called by the app's own window when a marker is clicked; the plugin is not
/// asked anything and does not run at all. Refused is a notice, not a strike:
/// approval may have changed since the badge was answered (spec §6).
///
/// Handed to `open` as one argument, never as a shell line: whatever the
/// plugin put in the URL is data, and `sh -lc` would make it a program.
#[tauri::command]
pub fn open_url(app: AppHandle, plugin: String, url: String) -> Result<(), String> {
    let target = Url::parse(&url).map_err(|_| format!("{plugin} asked to open something that is not a URL"))?;

    let approved = app.state::<Registry>().may_open(&plugin);
    let allowed = approved
        .iter()
        .filter_map(|entry| parse_prefix(entry))
        .any(|prefix| within(&prefix, &target));

    if !allowed {
        eprintln!("planner: {plugin} asked to open {url}, which nothing approves");
        return Err(format!("{plugin} is not allowed to open that address"));
    }

    std::process::Command::new("open")
        .arg(target.as_str())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not open {url}: {error}"))
}
