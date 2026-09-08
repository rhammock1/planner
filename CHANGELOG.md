# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A note to self: search `[^#.-:].\[` to find all the entries without punctuation.

## [Unreleased]

### Added

-   `tools/update` (`npm run update`) installs this checkout's plugins and themes into `~/.planner`, rebuilding the app first if anything has moved since the last one. One command, so the binary and the plugin beside it are never from different days — and it names what it did not touch, because an installed theme *wins* over the app's own copy and a stale one there looks like the app ignoring an edit
-   A plugin can move the theme's colours (`theme.tokens`). Its rule goes last in the cascade, so a plugin that moves a colour can move it. It is shown the theme's own tokens and asked to *move* those — a plugin that answered with colours of its own would replace a theme rather than warm it. Each colour is ticked on its own, so a manifest that grows its `moves` list in a later version is granted nothing new, and two plugins may not move the same one
-   `dusk`, the third reference plugin: the page warms after sunset and cools again at dawn, in quarter-hour steps over the hour either side. Sunrise is arithmetic, not a web service — it asks roughly where this Mac is (`macos.location.read`, two decimal places) or takes a `location` you type in. The precedent for the next plugin that thinks it needs the network
-   The fifteen-minute refresh now reaches every window, so a second window left open follows the clock too
-   `tools/rebuild --bundle` assembles and ad-hoc signs `Planner.app`. Anything gated on a macOS permission has to be tested from a bundle: cargo's binary carries `Info.plist` unsealed, and TCC ignores an unsealed one, so the prompt never appears under `npm run app`
-   A plugin can run a program you approved, argument by argument (`shell.run`). The command is declared in the manifest as an argument list — never a shell line — and `config.toml` holds the one line it renders to, so changing an argument shows up unapproved rather than running. Placeholders are bound to a day or to a setting *you* set; a value that is only the author's default does not bind. No shell, five seconds, and the process group goes with it
-   `git-activity`, the second reference plugin: one line for a repository that had commits that day. Not a work log — the daily note is that
-   Every contributing plugin now gets its own section on the day page, under the heading its manifest asks for. With two of them, `On the calendar` was wrong for one
-   Plugins can declare their own settings, and the ⌘, pane draws a row for each. Changing one restarts the plugin
-   `shell.open` prefixes can come from a setting, so the address a plugin opens is the one you typed rather than the one its author did
-   Plugins can put a marker after a line, and open the address behind it (`item.badge`, `shell.open`). `ticket-links` is the reference plugin
-   A plugin can be stopped, started and restarted from the settings pane without relaunching the app
-   The settings pane asks about what a plugin is *shown*, one sentence per slot, and says why a plugin was put away
-   A settings pane at `⌘,` (spec §3.6, §7). Every setting `config.toml` holds, plus the installed plugins with a switch each and one tick per capability they ask for — because a permission granted in a text editor months ago is one you will not remember granting. It writes the same file, comments and all, the moment a change is made
-   `⌘F` finds a line anywhere in the vault, from either window (spec §5.7). Results are grouped by day, newest first, and clicking one goes to it — the day itself in the popover, the week it sits in from the detached window. It matches the line as it is written rather than as the page reads it, so `!2026-09-04` finds the deadline you typed; there is no search index, because a decade of pages is under 2MB and a second structure is a thing that can be wrong about what is on disk
-   `⌘E` opens the day being shown in your own editor (spec §8). The vault is a folder of Markdown precisely so that anything this app gets wrong about a line can be put right by hand; `editor` was a setting nothing read. It falls back to `$VISUAL`, then `$EDITOR`, then whatever the system opens a `.md` with — and because the app is not a terminal, a terminal editor needs `editor` pointed at a script that opens one
-   A missing vault now offers a folder picker rather than a dead end (spec §8). What you pick is written into `config.toml` - the commented default on a first run, your own file with its comments intact after that. The app still never creates a vault somewhere you did not ask for
-   The vault is polled every two seconds when the filesystem's own notifications will not start, and the page says which of the two it is getting (spec §8). It used to print a line to a console nobody has open and carry on looking like an app that was watching
-   A line with a time on it now says so when the time comes (spec §5.9). The schedule is worked out in JavaScript and handed to the shell complete, because a hidden webview's timers are throttled and a reminder that fires whenever you next open the page is not a reminder. An alarm whose moment went by while the machine was asleep is dropped rather than fired late
-   The menu bar icon says how much of today is still open, and gains a dot when a deadline has come inside its lead time (spec §5.8). A day with nothing left leaves the icon bare, because `0` is a number you have to read and then dismiss. `menu_bar_count` and `menu_bar_horizon_dot` were settings the app read and then ignored; they now do what they say
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

### Changed

-   `dusk` reads the sky rather than a clock. Through twilight the surfaces deepen and a real sunset appears in `texture` — the glow entering from the sun's own bearing and sinking as it sets, the Belt of Venus rising on the edge opposite — and nothing that is *read* moves at all. At civil dusk the page turns over into a night page, inverted out of the theme's own two colours so it still works on a theme it has never seen, and left alone on a theme that is already dark. **It moves nine colours where it moved six**, so `texture`, `accent` and `alert` arrive unticked and want one visit to the ⌘, pane
-   The turn is a cut and not a fade, because it has to be: there is no continuous path from dark ink on light paper to light ink on dark that avoids the two passing through the same luminance, and the same luminance is a page you cannot read. So the page deepens to something that still holds its own dark ink, and then turns, at the hour a person reaches for a lamp anyway
-   Nothing on the page gets harder to read than it was at noon. The ink has room to spare and never moves before the turn; the quieter marks have none — Ledger's `dim` is 3.4:1 by design, and the same grey on the paper of last light is 1.9:1 — so each is walked just far enough to keep the contrast its own theme gave it. A contrast is a fact about a pair, and moving the paper is enough to put a mark out. A test walks four dates at four latitudes, a minute at a time, on a light theme and a dark one, and checks both halves of that
-   A theme whose colours are not hex is left alone rather than rearranged. `white` and `rgb(255,255,255)` are legal values for `paper` — `theme.js` checks what could escape a CSS rule, not what shape a colour is — and read two digits at a time `white` is `#000000`, which had `dusk` concluding the page was already dark and walking the paper down to meet ink that never moved. A legal theme would have spent every night as black text on a black page
-   `theme.tokens` is asked every minute rather than every quarter hour. Fifteen minutes is when the alarm thread wakes, which is a fact about the alarm; a slot whose whole subject is the passage of light cannot say anything in four steps an hour that does not read as four jumps. The clock runs only while some plugin has actually claimed a colour
-   `texture` carries its own position and size, written the way the `background` shorthand writes them. A `background-size` on `.page` governs *every* layer on it, so a theme sizing its own grain in `theme.css` tiled a plugin's sunset into 14-pixel squares — and a plugin cannot answer with a size, because a size is not a token. Ledger's dot grid moved into the token; a theme doing the same in its stylesheet should follow
-   `composition-book` writes its ruled lines out rather than reaching for `var(--texture)` to paint them behind the list. That was safe while a texture could only be the theme's own; now that a plugin can move it, the rule was about to paint somebody's sunset a second time at the wrong geometry — and lose the rules entirely after dark. A theme reaching for a token a plugin can move has to mean it
-   A plugin's token value may run to 400 characters, from 200. A sky is three gradient layers over whatever the theme had there already, and 200 was a guess about how long a *colour* is. Nothing that defends the value — the character and bracket checks — gets weaker with length
-   `dusk` works out where the sun is rather than when it rises and sets, which is less code and more answer: the wrapping-clock case that `warmthAt` existed to survive cannot arise from an altitude, a bearing falls out of the same arithmetic, and the polar circles get an answer instead of a refusal — Longyearbyen in January is a night page for months, which is correct rather than degenerate
-   `tools/update` assembles `Planner.app` by default, and `planner` on the `PATH` is kept pointing at it. The bare cargo binary is now the special case (`--no-bundle`), because macOS will not grant one a permission — an app that quietly cannot do two of the things it does is a poor thing to hand back to somebody who asked for their app
-   `slots` in `manifest.toml` is now read, and approved in `config.toml` as `approved_slots`. **A plugin installed before this version is asked nothing until its slot is ticked once**
-   `contribute` is gone as a command; every slot is asked through `ask_plugins`, which asks all of them at once and says who answered what

### Fixed

-   The location and calendar prompts appear again. Signing with `--options runtime` was half a rule: under the hardened runtime macOS also refuses those two resources unless the signature names them, and refuses them without a word to the app — `locationd` logs *doesn't have the entitlement, not sending #AuthPrompt* and stops. `src-tauri/Entitlements.plist` names them, `tools/rebuild --bundle` checks the signed result for one and registers the bundle with LaunchServices, which had no record of an app that has never been opened from Finder
-   A permission prompt appears again. `tools/update` had started keeping `planner` on the `PATH` as a symlink into `Planner.app`, and macOS identifies a process by the path it was executed as rather than what that resolves to — so the app registered with `bundleID=[ NULL ]`, TCC had nothing to attribute the request to, and the ask was made with no prompt ever drawn. It is a script that `exec`s the real path now, and the check behind the notice asks the framework for a bundle identifier instead of inspecting the path, which is what let the symlink through
-   The `Moves <colour>` ticks in the plugin pane draw like every other tick. `theme.tokens` invented a row kind and the stylesheet had no rule for it, so seven of them rendered at the body size, inline, running off the edge of the pane. A tick's kind is now a union rather than a string, and a test reads the kinds out of one file and the selectors out of the stylesheet
-   `dusk` under `npm run app` says it cannot ask for location, instead of saying it is asking for a prompt that is never coming. A cargo binary is not a bundle, TCC will not read its unsealed plist, and the status stays `NotDetermined` for as long as the app runs — so the notice named a remedy that did not exist
-   `dusk`'s location row hints at the format rather than showing a coordinate. A plausible pair of numbers in a greyed-out box reads as the value the field already holds, gets typed in, and puts the author's sunset on somebody else's evening — which is the default the manifest deliberately does not have, arriving by the other door
-   `tools/update --bundle` rebuilds a `Planner.app` older than the binary it should carry. The bundle is assembled by copying, so an existing one goes on holding whatever it was built from, and being handed yesterday's app is the worst answer for the one artefact that exists to test permissions
-   A theme value whose brackets or quotes do not close is refused. Nothing in it is forbidden, and CSS consumes an unclosed function to the end of the stylesheet — so one plugin's `rgb(` silently took every colour written after it, another plugin's included, with nothing on the page to say so
-   A location grant that is taken back stops being answered. A call whose hop to the main thread ran out fell back on the last fix instead of failing, so turning location services off left a plugin reading where the Mac used to be. One fix now lasts the quarter hour and is rounded when it is taken rather than on the way out, so a plugin cannot poll its way to a finer answer than the one it is allowed
-   `dusk` no longer lights the night palette all day west of about 165°. Sunset there falls after local midnight, which makes it the *smaller* number, and a day read as the interval between two numbers had no daytime in it at all
-   A plugin's colours stay on the page while it is asked again. Every fifteen-minute refresh and every opening of the popover is a fresh question, and the page was painting the empty answer that a question in flight gives back — a white flash four times an hour through dusk
-   A plugin that answers with nothing is no longer accused of answering with the wrong shape. `theme.tokens` replies with a map, and a handler that simply returned was being reported as having sent a list
-   The plugin sandbox is closed where the review found it open (spec §0.2). A plugin can no longer navigate its webview off its own page, which is how `connect-src 'none'` was got round; WebRTC is removed from every frame, because a `stun:` hostname is a network request no CSP directive covers; and the door is asynchronous with one call in flight per plugin, so a capability that blocks no longer blocks the app. A plugin put away for the session now has its webview closed rather than merely ignored, a folder whose name could rewrite `config.toml` is refused before its manifest is read, and a calendar may be asked about sixty-two days at a time rather than a decade
-   The popover follows the clock over midnight. Left open overnight it went on showing yesterday, so the first glance of the morning was the wrong page and the carry-forward band only appeared once you pressed the today dot yourself. The day being shown was worked out at launch and then kept; it is now brought up to date at every redraw. A page you flipped to on purpose still stays where you put it, and the roll-over happens at the redraw rather than under a gesture, so a line added at one minute past midnight lands on the page you were looking at
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
