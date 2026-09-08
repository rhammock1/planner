//! Running a program for a plugin (spec §3.2).
//!
//! Everything here is about a process rather than about a manifest, which is
//! why it is not in `run.rs`: by the time anything in this file is called, the
//! argument list has already been bound and approved, and what is left is the
//! operating system's half of the promise.
//!
//! Three things that are not obvious and are all deliberate:
//!
//! - **The PATH is a login shell's.** Homebrew's `git` lives where
//!   `~/.zprofile` puts it, and `sh -lc` reads `~/.profile`, which on a zsh
//!   machine says nothing at all. So `$SHELL -lc 'echo $PATH'` is run once and
//!   the answer kept - with a limit on it, because a profile that prompts
//!   would otherwise hang the first command a plugin ever ran.
//! - **The cap is on what is kept, not on what is read.** A child whose pipe
//!   fills up blocks forever; a reader that stopped reading at the cap would
//!   turn every chatty command into a timeout.
//! - **The kill is on the process group.** `Child::kill` reaches the program
//!   this app started and not whatever that program started.

use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How long a command gets before its process group is killed.
pub const LIMIT: Duration = Duration::from_secs(5);

/// How much of what a command said is carried back to the plugin.
///
/// A quarter of a megabyte is more `git log` than any day has. It is also the
/// only cap on this: `door::too_large` weighs what a plugin *sends in*, and a
/// capability's reply is a return value that nothing else measures.
pub const STDOUT_CAP: usize = 256 * 1024;

/// Errors are read by people, and four kilobytes is a screenful of them.
pub const STDERR_CAP: usize = 4 * 1024;

/// How long a finished command's output is waited for after it is finished.
///
/// Not part of the five seconds: by the time this is spent the command has
/// exited or been killed, and this is only the difference between the pipes
/// closing and somebody noticing. It is a second rather than nothing because
/// on the ordinary path the reader is already at the end and this costs
/// microseconds - and see `gathered` for the path where it is not.
const GATHER: Duration = Duration::from_secs(1);

/// Where a program is looked for when the login shell will not say.
///
/// Both Homebrew prefixes are here on purpose: this is the path a machine
/// whose profile hangs falls back to, and a `git` it cannot find is the whole
/// feature not working.
const FALLBACK: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/// How long the PATH capture itself gets. The same limit a command gets: a
/// profile that asks a question is a profile that never answers.
const CAPTURE: Duration = Duration::from_secs(5);

/// What a finished command left behind.
///
/// `status` is `None` when the command was killed rather than exiting - which
/// is what a plugin is told, so that "it took too long" and "it exited 0" are
/// not the same answer.
pub struct Finished {
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// The PATH a login shell would have, captured once per launch.
///
/// `OnceLock::get_or_init` holds every other caller until the first one is
/// done, so it happens exactly once however many plugins ask at the same
/// moment. `lib.rs` calls this on a thread of its own at startup, so that the
/// waiting is usually already over by the time a plugin asks - a lazy capture
/// would otherwise put the whole of `CAPTURE` in front of the first command of
/// the session, on top of that command's own five seconds.
pub fn login_path() -> &'static str {
    static CAPTURED: OnceLock<String> = OnceLock::new();
    CAPTURED.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let mut command = Command::new(&shell);
        command.args(["-lc", "echo $PATH"]).stdin(Stdio::null());

        match limited(&mut command, CAPTURE, (STDOUT_CAP, STDERR_CAP)) {
            Ok(done) => {
                let said = String::from_utf8_lossy(&done.stdout).trim().to_string();
                // What it said, not whether it finished saying it. A profile
                // that starts an agent in the background holds stdout open
                // long after `echo` has written the one line this wants, and
                // that shell is killed with a status of `None` - so reading
                // the status here would put every such machine on the
                // fallback PATH, which is the bug this whole function exists
                // to avoid.
                if said.contains('/') {
                    said
                } else {
                    // Said out loud rather than swallowed: a plugin that
                    // cannot find `git` is a bug report with no first line
                    // (spec §8).
                    eprintln!("planner: {shell} reported no PATH (status {:?}); using a built-in one", done.status);
                    FALLBACK.to_string()
                }
            }
            Err(error) => {
                eprintln!("planner: could not ask {shell} for a PATH ({error}); using a built-in one");
                FALLBACK.to_string()
            }
        }
    })
}

/// The program a command names, as a path this app is willing to run.
///
/// A name is looked up on `path`. A path must be absolute: a relative one
/// would be resolved against the working directory, and the working directory
/// is not something a manifest chose. Whatever comes out is canonical, and is
/// refused if it lands under `refused` - which is `~/.planner`, where a
/// plugin's own files live. Approving `git` must not approve whatever a plugin
/// decided to call `git`.
pub fn resolve(program: &str, path: &str, refused: Option<&Path>) -> Result<PathBuf, String> {
    let found = if program.contains('/') {
        let at = Path::new(program);
        if !at.is_absolute() {
            return Err(format!(
                "{program} is a relative path; give an absolute one, or a name to look up"
            ));
        }
        runnable(at)
    } else {
        path.split(':')
            // Absolute only. Refusing a relative *program* eleven lines above
            // and then accepting a relative PATH *folder* would let the same
            // thing back in by another door: `.` and `node_modules/.bin` are
            // both ordinary entries in a developer's PATH, and both resolve
            // against this process's working directory rather than against
            // anything a manifest chose.
            .filter(|folder| Path::new(folder).is_absolute())
            .find_map(|folder| runnable(&Path::new(folder).join(program)))
    };

    let Some(found) = found else {
        return Err(format!("{program} is not a program on the PATH this app was given"));
    };
    // Against the canonical path, so a symlink out of somewhere allowed into
    // `~/.planner` is caught by the same line.
    if let Some(refused) = refused {
        // Both forms, because `found` is canonical and this one might not be:
        // `canonicalize` fails on a folder that is not there yet, and returns
        // a different path when `PLANNER_HOME` is reached through a symlink.
        // `starts_with` is component-wise, so comparing a canonical path with
        // a raw one silently never matches - which is this check quietly not
        // running. Said out loud when it happens (spec §8).
        let canonical = std::fs::canonicalize(refused).ok();
        if canonical.is_none() {
            eprintln!(
                "planner: could not resolve {} to check what a plugin may run",
                refused.display()
            );
        }
        let refused = canonical.unwrap_or_else(|| refused.to_path_buf());
        if found.starts_with(&refused) {
            return Err(format!(
                "{program} resolves inside {}, which a plugin may not run out of",
                refused.display()
            ));
        }
    }
    Ok(found)
}

/// A file with an execute bit, by its real path, or nothing.
fn runnable(at: &Path) -> Option<PathBuf> {
    let real = std::fs::canonicalize(at).ok()?;
    let data = std::fs::metadata(&real).ok()?;
    if !data.is_file() || data.permissions().mode() & 0o111 == 0 {
        return None;
    }
    Some(real)
}

/// Runs a command, and does not wait longer than it was told to.
///
/// The caller has already decided everything about the command except how long
/// it may take and how much of what it says is worth keeping. Both output
/// streams are drained on threads of their own for as long as the process
/// lives, because a child that fills a pipe stops running until somebody reads
/// it - so a cap enforced by *not reading* would turn into a hang.
///
/// `caps` is `(stdout, stderr)`, in bytes.
pub fn limited(command: &mut Command, limit: Duration, caps: (usize, usize)) -> Result<Finished, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Its own group, so the kill below reaches whatever it started too.
        .process_group(0)
        .spawn()
        .map_err(|error| format!("could not start it: {error}"))?;

    let out = child.stdout.take().map(|pipe| drain(pipe, caps.0));
    let err = child.stderr.take().map(|pipe| drain(pipe, caps.1));

    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {}
            Err(error) => return Err(format!("could not wait for it: {error}")),
        }
        if Instant::now() >= deadline {
            kill_group(child.id());
            // Reaped, so nothing is left as a zombie. The kill has already
            // gone out, so this returns rather than waiting on anything.
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };

    Ok(Finished {
        status,
        stdout: out.map(|reader| gathered(reader, GATHER)).unwrap_or_default(),
        stderr: err.map(|reader| gathered(reader, GATHER)).unwrap_or_default(),
    })
}

/// A pipe being read on a thread of its own.
///
/// The bytes are shared rather than returned, because the thread cannot be
/// relied on to end - see `gathered`. `ended` carries nothing; the send is the
/// message.
struct Reader {
    held: Arc<Mutex<Vec<u8>>>,
    ended: Receiver<()>,
}

/// Reads a pipe to its end, keeping only the first `cap` bytes.
fn drain(mut pipe: impl Read + Send + 'static, cap: usize) -> Reader {
    let held = Arc::new(Mutex::new(Vec::new()));
    let writing = Arc::clone(&held);
    let (tell, ended) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match pipe.read(&mut buffer) {
                Ok(0) => break,
                // A pipe that errors is a pipe that is gone, which is the same
                // thing as one that ended as far as this is concerned.
                Err(_) => break,
                Ok(read) => {
                    let mut held = writing.lock().expect("drain lock");
                    if held.len() < cap {
                        let room = cap - held.len();
                        held.extend_from_slice(&buffer[..read.min(room)]);
                    }
                }
            }
        }
        // Nobody may be listening any more, and that is fine: the bytes are in
        // the shared buffer either way.
        let _ = tell.send(());
    });

    Reader { held, ended }
}

/// What a reader gathered, waiting for the end of the pipe but not forever.
///
/// A pipe ends when every process holding its write end has let go, and the
/// command exiting is not that. `/bin/sh -c '(sleep 30) & echo hi'` exits at
/// once and leaves a subshell holding stdout for half a minute; a program that
/// called `setsid()` leaves the process group and survives the kill entirely.
/// Waiting for the end of the pipe in either case would hold this call - and
/// with it the plugin's one in-flight slot, and on the first call the whole
/// app's PATH capture - for as long as that process lives.
///
/// So: the end of the pipe, or `grace`, whichever comes first, and whatever
/// was read by then. A thread left blocked on a pipe nobody will close holds
/// one read end and eight kilobytes until the app exits, which is the cheaper
/// of the two things to leak.
fn gathered(reader: Reader, grace: Duration) -> Vec<u8> {
    let _ = reader.ended.recv_timeout(grace);
    reader.held.lock().map(|held| held.clone()).unwrap_or_default()
}

/// Kills a process group by the leader's id.
///
/// The one `libc` call in this app. `Child::kill` sends a signal to the child
/// and to nothing it started; `process_group(0)` above is what makes the
/// negative pid below mean "everything that came of this".
fn kill_group(pid: u32) {
    let leader = i32::try_from(pid).unwrap_or(0);
    if leader <= 0 {
        return;
    }
    // Safety: `kill` with a negative pid signals a process group, and this
    // group is one this app created a moment ago with `process_group(0)`.
    unsafe { libc::kill(-leader, libc::SIGKILL) };
}
