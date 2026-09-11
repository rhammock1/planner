// The windows are the interface; a console behind them is not.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use planner_lib::cli::{self, Intent};

fn main() {
    // Before Tauri, deliberately. See the module comment in `cli.rs`: the
    // second `planner` of the day is killed from inside Tauri's setup, so
    // anything this process has to say has to be said before then.
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let home = dirs::home_dir();

    match cli::read(&args, &cwd, home.as_deref()) {
        Intent::Help => println!("{}", cli::USAGE),
        Intent::Version => println!("planner {}", env!("CARGO_PKG_VERSION")),
        Intent::Refused(why) => {
            eprintln!("{why}");
            eprintln!("Try: planner --help");
            std::process::exit(2);
        }
        intent => planner_lib::run(intent),
    }
}
