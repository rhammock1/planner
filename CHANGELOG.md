# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A note to self: search `[^#.-:].\[` to find all the entries without punctuation.

## [Unreleased]

### Added

-   Plugins (spec §7). A plugin is a folder in `~/.planner/plugins` that `config.toml` switches on. It runs in its own hidden webview with no permissions of its own, may call exactly one command, cannot reach the network, and has two seconds to answer anything before it is put away for the session. The API is published in `docs/plugins.md`
-   `macos-calendar`, the first plugin: the day's events under your list, read-only, and not counted towards how much is left. It is also the API's own test — it is written against the public API with no privilege the API does not grant
-   The day page asks the plugins again every time the popover opens, rather than showing what they said at launch. Which is also how a calendar permission granted a minute ago first has an effect
-   The detached window (spec §5.6). The footer's `WEEK`, `MONTH` and `SOMEDAY` tabs, and `⌘↩`, open a second ordinary window that stays where you put it: the week as seven columns, the month as a grid, and `someday.md` as one list
-   The week - seven columns Monday first, today marked, each a day's list with its own add row, and arrows that move a whole week at a time
-   The month - a cell per day carrying how much is still open on it and a mark when something anywhere in the vault is due that day. Clicking a cell goes to the week that day sits in
-   The back page - `someday.md` given a surface of its own, so things without a day yet no longer need a text editor
-   Dragging a line from one day to another. A day still ahead simply loses the line; a day already gone keeps the record - `[>]` with the date it went to - the same way carry-forward does
-   Pin the popover open. Unpinned it closes when you click elsewhere; pinned it stays, its header becomes a handle you can drag it anywhere by, and it reopens where you left it rather than snapping back under the menu bar
-   The popover can be resized, and the list scrolls inside whatever size it is given
-   The day's own note at the bottom of the page can be written in, not only read. It used to be hidden when empty, which left no way to start one
-   `⌘⌫` crosses a task out, recording that you decided against it. Pressed again on a line already crossed out, it takes the line off the page entirely — for the typo, the duplicate, and somebody else's example
-   Rubbing out a line's words removes it, so long as it carries nothing else. A line with a time, a deadline or a note keeps its words instead: those are worth more than the keystroke that emptied them
-   `Shift+Enter` on a task opens the line underneath it - the note the file format always carried, with no way in but a text editor. Emptying it takes it away again
-   Escape puts the popover away
-   The menu bar icon has a tooltip
-   Markdown vault format - one file per day plus a `someday.md` back page, with item states `[ ]` `[x]` `[>]` `[-]`, inline `@time` `!due` `~lead` `>moved` tokens, per-item notes and a daily note
-   Lossless parsing - any line the parser does not recognise is preserved byte-for-byte, so a hand-edited file can hold anything without risk
-   Round-trip guarantee - reading and writing a canonical file returns it unchanged, and a non-canonical file is normalised once and then holds steady
-   YAML frontmatter is preserved and never interpreted, so a vault opened in Obsidian keeps parsing correctly
-   `tools/dump.js` for inspecting a vault file - parsed structure, canonical rewrite, or a round-trip check
-   `docs/format.md` publishing the vault format as a contract
-   An in-memory index over the vault, keyed by day or `someday`, mapping page keys to file paths and back
-   The horizon strip's rules - an item enters when its due date falls inside its lead time, overdue items sort first, and nothing ages out until it is dealt with
-   Carry-forward - unfinished items from past days are kept or dropped, and today is written first so a failed write can only duplicate an item, never lose one
-   Natural-language entry - `tomorrow`, weekday names, `in 3 days`, `9/2`, `sep 2`, `8:40`, `4pm`, `at 4`, and `by friday` or `due sep 2` for deadlines
-   UTC calendar arithmetic, so no date shifts under a daylight saving transition
-   Quick add - a global shortcut (`Alt+Space` by default) opens one field anywhere on the system, with a live preview of how the line was read before it is committed
-   The macOS shell - a menu bar item, a popover that opens under it, atomic writes, and a file watcher so an edit made in an editor shows up in the app
-   `PLANNER_HOME` to relocate config and installed themes, for running against a throwaway setup
-   The day page - date header with day-to-day navigation, horizon strip, item list, add row, daily note and footer count
-   Carry-forward on the page - keep everything from an earlier day in one click, or review it line by line
-   Toggling and adding items, written through the same path an edit made in an editor takes
-   `config.toml` - read with defaults for anything missing, written back without disturbing comments, alignment or keys the app does not know
-   Themes - `theme.toml` tokens published as a contract in `docs/themes.md`, with Ledger, Composition Book and Console bundled
-   Editing an item's text in place, with Enter to finish and Escape to put back what was there
-   A keyed list patcher that leaves a row alone while the caret is in it
-   `npm run serve` and a sample vault, so the frontend runs in a browser before the Tauri shell exists
-   Project toolchain - `node --test`, TypeScript as a checker only, no build step, zero runtime dependencies

### Fixed

-   A day with more lines than fit no longer pushes the footer off the bottom of the window. Nothing gave the page a height, so it grew past the window and took the tabs and the count somewhere no scrollbar could reach
-   A row is repainted while its own text holds the caret. Only that one element is left alone now, not the whole row — a line crossed out while you were in it went on looking open, which is a page inviting you to delete something it never showed you striking out
-   Every edit now appears. Ticking a box, adding a line, keeping or dropping a carried item all reached the file and none of them reached the screen: the webview had no permission to listen for the change event, and the app only ever repaints when that arrives
-   Clicking the menu bar icon now opens the popover under it. The icon's position arrives in physical pixels and was read as logical points, so on any Retina display the popover opened a screen's width off to the right, correctly and invisibly
-   The popover is pulled back onto the screen when the icon sits near its right edge, and hangs below the menu bar rather than under it
-   The vault is opened once, not once per window. Quick add opening for the first time put a second watcher on the same folder
-   The horizon strip no longer fades its first entry away. The fade is there so scrolling text dissolves at the edges; applied to a strip that fits, it dissolved the lead time and the start of the item behind it
-   An echo now covers the whole of a write. One save reaches the watcher as several filesystem events, and only the first was recognised as the app's own - the rest were reported as edits made somewhere else
-   The vault is watched and the shortcut registered from launch, rather than from the first time the popover was opened
-   A vault reached through a symlink is now watched - the watcher reports canonical paths, so `/tmp/vault` never matched `/private/tmp/vault` and edits made elsewhere went unnoticed
-   Ticking a checkbox now shows immediately - a click focuses the box, and the rule protecting text being typed was holding off the row's repaint
-   Two quick changes no longer discard one another - each one read the page as it was before the other was written
-   Space toggles the item under the keyboard focus
-   A daily-note rule with nothing after it is no longer deleted on save - a file ending in `---` lost one rule per save until none were left
-   Files with CRLF line endings now parse their items instead of reading as an empty day
-   A leading blank line or byte-order mark no longer demotes a day file to the back page
-   Tabs, non-breaking spaces and repeated spaces inside item text are preserved instead of collapsed to a single space
