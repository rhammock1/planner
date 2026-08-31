// The windows are the interface; a console behind them is not.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    planner_lib::run()
}
