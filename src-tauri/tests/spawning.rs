//! Running a program: which one, for how long, and how much it may say.
//!
//! These run real processes, deliberately - `/bin/echo`, `/bin/sh`, `/bin/cat`
//! are on every Mac this app supports, and the behaviour being checked is the
//! operating system's rather than this app's arithmetic about it.

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use planner_lib::plugins::spawning::{limited, login_path, resolve, LIMIT, STDERR_CAP, STDOUT_CAP};

fn caps() -> (usize, usize) {
    (STDOUT_CAP, STDERR_CAP)
}

fn plain(program: &str, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null());
    command
}

#[test]
fn a_name_is_found_on_the_path_it_is_given() {
    let found = resolve("echo", "/nowhere:/bin", None).expect("echo is not on /bin");
    assert_eq!(found, PathBuf::from("/bin/echo"));
}

#[test]
fn a_name_that_is_not_on_the_path_is_refused_by_name() {
    let refused = resolve("echo", "/nowhere", None).unwrap_err();
    assert!(refused.contains("echo"));
}

#[test]
fn a_path_must_be_absolute() {
    assert!(resolve("./echo", "/bin", None).is_err());
    assert!(resolve("../bin/echo", "/bin", None).is_err());
    assert!(resolve("bin/echo", "/bin", None).is_err());
}

#[test]
fn a_program_inside_the_planner_folder_is_refused_however_it_is_reached() {
    // A plugin is served out of `~/.planner/plugins/<name>/`, so a program it
    // shipped is a program it wrote - and approving `git` would then approve
    // whatever the plugin called `git`. Planted in a folder of its own rather
    // than pointed at `/bin`, so this tests the rule and not the coincidence
    // that `/bin/echo` is under `/bin`.
    let refused = std::env::temp_dir().join("planner-spawning-refused");
    let _ = std::fs::remove_dir_all(&refused);
    std::fs::create_dir_all(&refused).expect("could not make the folder");
    let planted = refused.join("git");
    std::fs::write(&planted, "#!/bin/sh\nexit 0\n").expect("could not plant it");
    std::fs::set_permissions(&planted, std::fs::Permissions::from_mode(0o755)).unwrap();

    let path = format!("{}:/bin", refused.display());
    // Found by name, through a PATH entry that points into the folder.
    assert!(resolve("git", &path, Some(&refused)).is_err());
    // And by the absolute path, which is the same file said another way.
    assert!(resolve(planted.to_str().unwrap(), &path, Some(&refused)).is_err());
    // With nothing refused it is found, so this is a test of the rule rather
    // than of the file not being there.
    assert!(resolve("git", &path, None).is_ok());

    let _ = std::fs::remove_dir_all(&refused);
}

#[test]
fn something_that_is_not_a_program_is_not_resolved() {
    assert!(resolve("/etc/hosts", "/bin", None).is_err());
    assert!(resolve("/bin", "/bin", None).is_err());
    assert!(resolve("/no/such/thing", "/bin", None).is_err());
}

#[test]
fn what_a_program_said_comes_back_with_its_status() {
    let done = limited(&mut plain("/bin/echo", &["hello"]), LIMIT, caps()).unwrap();
    assert_eq!(done.status, Some(0));
    assert_eq!(String::from_utf8_lossy(&done.stdout).trim_end(), "hello");
    assert!(done.stderr.is_empty());
}

#[test]
fn a_program_that_failed_says_so_in_its_status() {
    let done = limited(&mut plain("/bin/sh", &["-c", "echo oh no >&2; exit 3"]), LIMIT, caps()).unwrap();
    assert_eq!(done.status, Some(3));
    assert_eq!(String::from_utf8_lossy(&done.stderr).trim_end(), "oh no");
}

#[test]
fn a_program_that_overruns_is_killed_and_has_no_status() {
    let started = Instant::now();
    let done = limited(
        &mut plain("/bin/sh", &["-c", "sleep 30"]),
        Duration::from_millis(300),
        caps(),
    )
    .unwrap();
    assert_eq!(done.status, None, "an overrunning program reported a status");
    assert!(started.elapsed() < Duration::from_secs(5), "the limit was not the limit");
}

#[test]
fn a_program_that_starts_another_takes_it_with_it() {
    // The process group, not the child. A `sh` that backgrounded something
    // would otherwise leave it running with nothing left to kill it.
    let marker = std::env::temp_dir().join("planner-spawning-group-check");
    let _ = std::fs::remove_file(&marker);
    let script = format!("(sleep 1; touch {}) & sleep 30", marker.display());

    let done = limited(
        &mut plain("/bin/sh", &["-c", &script]),
        Duration::from_millis(200),
        caps(),
    )
    .unwrap();
    assert_eq!(done.status, None);

    std::thread::sleep(Duration::from_millis(1500));
    assert!(!marker.exists(), "a grandchild outlived the group it was killed with");
}

#[test]
fn a_program_that_will_not_stop_talking_is_cut_rather_than_believed() {
    // And it must not deadlock: a child whose pipe fills up blocks forever,
    // so the cap is on what is *kept*, not on what is read.
    let done = limited(
        &mut plain("/bin/sh", &["-c", "yes planner | head -c 2000000"]),
        Duration::from_secs(20),
        (1024, 64),
    )
    .unwrap();
    assert_eq!(done.stdout.len(), 1024);
    assert_eq!(done.status, Some(0));
}

#[test]
fn a_program_that_left_something_holding_its_output_does_not_hold_the_app() {
    // The command exits at once, so nothing kills anything - but the subshell
    // it backgrounded inherited stdout and sits there for half a minute. A
    // reader that waited for the end of the pipe would wait with it, and this
    // call holds the plugin's one in-flight slot while it does.
    let started = Instant::now();
    let done = limited(&mut plain("/bin/sh", &["-c", "(sleep 30) & echo hi"]), LIMIT, caps()).unwrap();

    assert_eq!(done.status, Some(0));
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "waited {:?} for a command that exited at once",
        started.elapsed()
    );
    // And what it managed to say is still carried back: the bytes are read as
    // they arrive rather than handed over at the end.
    assert_eq!(String::from_utf8_lossy(&done.stdout).trim_end(), "hi");
}

#[test]
fn a_program_is_never_asked_anything() {
    // stdin is closed. A command that waits for input would otherwise sit
    // there until the limit, every single time.
    let done = limited(&mut plain("/bin/cat", &[]), Duration::from_secs(2), caps()).unwrap();
    assert_eq!(done.status, Some(0));
    assert!(done.stdout.is_empty());
}

#[test]
fn the_login_path_is_a_path_and_is_captured_once() {
    let once = login_path();
    assert!(once.contains('/'), "the captured PATH is not a path: {once}");
    assert!(std::ptr::eq(once, login_path()), "the PATH was captured twice");
}
