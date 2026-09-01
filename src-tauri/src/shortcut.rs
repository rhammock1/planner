//! How a shortcut is written where a person reads it.

/// The accelerator as a Mac writes it: `Alt+Space` reads back `⌥+Space`.
///
/// Only the modifiers are translated. The key keeps whatever name the config
/// gave it - `Space` stays `Space`, because `␣` in a log line is a puzzle,
/// not a shorthand.
pub fn symbols(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|part| {
            match part.trim().to_ascii_lowercase().as_str() {
                "cmd" | "command" | "super" | "meta" | "cmdorctrl" | "cmdorcontrol" => "⌘",
                "alt" | "option" => "⌥",
                "shift" => "⇧",
                "ctrl" | "control" => "⌃",
                _ => part,
            }
            .to_string()
        })
        .collect::<Vec<_>>()
        .join("+")
}
