# Planner

A macOS menu bar planner. Click the icon, get today's page: a short list of
what you are doing, written the way you would write it in a school assignment
notebook. Flip to other days. See what is coming. Close it.

It is not a task manager, and it is trying hard not to become one.

*Early days — the vault format, the domain logic, the day page, the detached
window, the menu bar shell, quick add and the plugin host are built.
Notifications and search are not.*

## Goals

- **A page per day.** One list. Some lines carry a time, a due date, or a note
  underneath. No projects, no boards, no nesting.
- **Deadlines you see coming.** A thin horizon strip above the list, with a
  per-item lead time so distant things stay quiet until they matter.
- **Nothing rots.** Unfinished items surface on the next day to keep or drop,
  and the old page records which.
- **Three seconds to capture.** A global hotkey, one line, Enter.
- **Yours, in plain files.** No database, no account, no sync service.
- **Extensible without bloating.** Themes are colour tokens in a folder;
  plugins are sandboxed JS. Calendar and Reminders are plugins, not core.

## Your data is a folder of Markdown

One file per day, plus `someday.md` for things without a day yet.

```
~/Planner/
  2026/08/2026-08-31.md
  someday.md
```

```markdown
# 2026-08-31

- [x] Standup - flag the merchant sync bug
- [ ] Pair with Dana on the offline queue @10:30
- [ ] Review PR #4412 - printer retry
  > ask about the 30s timeout
- [ ] Firmware sign-off !2026-09-02 ~10d

---

Shipped the retry fix.
```

Edit them in any editor, grep them, put them in git. Anything the app does not
recognise is preserved exactly as you wrote it. The full contract is in
[docs/format.md](docs/format.md).

## Plugins

Calendar and Reminders are plugins rather than features, which is how the
app stays a planner. `macos-calendar` ships in `plugins/` and puts the day's
events under your list — read-only, and not counted:

```bash
cp -R plugins/macos-calendar ~/.planner/plugins/
```

```toml
# ~/.planner/config.toml
[plugins.macos-calendar]
enabled               = true
approved_capabilities = ["macos.calendar.read"]
```

macOS asks for calendar access the first time; open the popover again once
you have allowed it.

`git-activity` ships beside it and puts one line under the day for a
repository that had commits — it is the one that runs a program, so its pane
shows the whole command line and nothing runs until you have ticked it:

```bash
cp -R plugins/git-activity ~/.planner/plugins/
```

`dusk` warms the page after sunset. It is the one that shows what a plugin can
do without the network: sunrise is arithmetic on a date and two numbers.

A plugin runs in its own webview with no permissions, may call exactly one
command, cannot reach the network, and has two seconds to answer anything.
The API is published in [docs/plugins.md](docs/plugins.md).

## Stack

| Layer | What |
|---|---|
| Shell | Tauri 2 (Rust) - menu bar item, windows, global hotkey, atomic writes, file watcher, the plugin sandbox and its capability bridges |
| App | Plain ES modules. No framework, no build step, zero runtime dependencies |
| Types | TypeScript as a checker only - `tsc --noEmit` over JSDoc |
| Tests | `node --test` - no toolchain, no app launch |
| Storage | Markdown files in a folder you choose |

Domain logic lives in `src/core/` and is pure - no DOM, no file access, no
clock - so the code most likely to lose your writing is testable in a terminal
in under a second.

## Development

```bash
npm install
npm test          # node --test, the domain logic
npm run typecheck # tsc over core and the frontend, separately
npm run serve     # a static server on 127.0.0.1:8731
```

`npm run typecheck` runs twice: `core/` is checked without the DOM library, so
a pure module that reaches for `document` fails to compile rather than failing
review.

With the server running:

- <http://127.0.0.1:8731/src/index.html> — the day page. There is no Tauri host
  in a browser, so `ipc.js` falls back to an in-memory sample vault. The data
  flow is the real one: an edit is serialised, written, and read back before
  anything on screen changes. Add `?theme=console` or `?theme=composition-book`
  to see the other bundled themes; they load exactly as they will from
  `~/.planner/themes/`.
- <http://127.0.0.1:8731/src/spread.html?view=week> — the detached window.
  `?view=month` and `?view=someday` are the other two.
- <http://127.0.0.1:8731/test/browser/keyed-list.html> — the checks that need a
  real browser, because they are about focus, the caret, layout and drag.
  `horizon-strip`, `item-list`, `day-page` and `spread-page` are the others.

### Running the app

Needs a Rust toolchain ([rustup](https://rustup.rs)); the JavaScript above
does not.

```bash
npm run app       # cargo run, from src-tauri/
```

It puts an item in the menu bar and nothing else — no dock icon, no window
until you click it. The icon carries how much of today is still open, and a
dot when a deadline has come inside its lead time; `menu_bar_count` and
`menu_bar_horizon_dot` turn either off. A line with an `@10:30` on it gets a
notification when ten thirty comes round. If the vault folder is not there,
the page says so and offers to pick one — it will not make one for you.
`⌘E` opens the day you are looking at in your own editor: `editor` in
`config.toml`, else `$VISUAL`, `$EDITOR`, or whatever the system opens a `.md`
with. The app is not a terminal, so a terminal editor wants `editor` pointed at
a script that opens one. `⌘F` finds a line anywhere in the vault from either
window, grouped by day. `⌘,` opens the settings: everything `config.toml`
holds, and a switch per installed plugin with a tick per capability it asks
for. The page can be resized, and the list scrolls inside it. Clicking away closes the page again; the pin in its header
keeps it open, and a pinned page can be dragged anywhere by that header and
reopens where you left it. Unpin it and it goes back to opening under the
icon.
`Shift+Enter` on a line opens the note underneath it, and `⌘⌫` crosses a line
out — press it again on a line already crossed out and it comes off the page
for good. The footer's `WEEK`, `MONTH` and `SOMEDAY` tabs — or `⌘↩` — open a
second, ordinary window: seven columns of the week you can drag lines between,
a month grid of counts and deadline markers, and `someday.md` as one list.
Lines in a week column are read-only, because a column you can write in is a
column you cannot drag out of; the day page is where lines are written.
`⌥Space` opens the
quick-add field from anywhere; the shortcut is `hotkey` in `config.toml`. Settings and installed themes live in `~/.planner`, and
the vault at whatever `config.toml` says, defaulting to `~/Planner`. Set
`PLANNER_HOME` to point the first of those somewhere else, which is how the
app gets run against a throwaway config:

```bash
PLANNER_HOME=/tmp/planner-home npm run app
```

`cd src-tauri && cargo test` runs the Rust side: path mapping, atomic writes,
echo suppression, and what a plugin is and is not allowed to do.

Inspect a vault file:

```bash
node tools/dump.js path/to/2026-08-31.md          # parsed structure
node tools/dump.js path/to/2026-08-31.md --canon  # canonical rewrite
node tools/dump.js path/to/2026-08-31.md --check  # does it round-trip?
```

## What it will never do

No subtasks or outlines. No projects, boards, or kanban. No time tracking. No
accounts, sharing, or sync service. No priorities or tags. No AI in core.

If it does not fit on a ruled page, it belongs in a plugin.
