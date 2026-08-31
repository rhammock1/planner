# Planner

A macOS menu bar planner. Click the icon, get today's page: a short list of
what you are doing, written the way you would write it in a school assignment
notebook. Flip to other days. See what is coming. Close it.

It is not a task manager, and it is trying hard not to become one.

*Early days — the vault format, the domain logic, the day page and the menu
bar shell are built. Quick add, the detached window, plugins and notifications
are not.*

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

## Stack

| Layer | What |
|---|---|
| Shell | Tauri 2 (Rust) - menu bar item, windows, global hotkey, atomic writes, file watcher, notifications |
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
- <http://127.0.0.1:8731/test/browser/keyed-list.html> — the checks that need a
  real browser, because they are about focus and the caret.

### Running the app

Needs a Rust toolchain ([rustup](https://rustup.rs)); the JavaScript above
does not.

```bash
npm run app       # cargo run, from src-tauri/
```

It puts an item in the menu bar and nothing else — no dock icon, no window
until you click it. Settings and installed themes live in `~/.planner`, and
the vault at whatever `config.toml` says, defaulting to `~/Planner`. Set
`PLANNER_HOME` to point the first of those somewhere else, which is how the
app gets run against a throwaway config:

```bash
PLANNER_HOME=/tmp/planner-home npm run app
```

`cd src-tauri && cargo test` runs the Rust side: path mapping, atomic writes
and echo suppression.

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
