# The vault format

Planner stores one Markdown file per day. The files are the app's data
format and its public interface — everything else is an editor for them.
Edit them by hand, grep them, put them in git.

## Layout

    ~/Planner/
      2026/08/2026-08-31.md    one file per day, created lazily
      someday.md               the back page

A `someday.md` file may carry a daily note; it is preserved like any other.

## A day file

    # 2026-08-31

    - [x] Standup — flag the merchant sync bug
    - [ ] Pair with Dana on the offline queue @10:30
    - [ ] Review PR #4412 — printer retry
      > ask about the 30s timeout
    - [ ] Firmware sign-off !2026-09-02 ~10d
    - [>] Order the Pi Zero >2026-09-01
    - [-] Reply to the vendor survey

    ---

    Shipped the retry fix.

## Checkbox states

| Token | Meaning                  |
|-------|--------------------------|
| `[ ]` | Open                     |
| `[x]` | Done (`[X]` also read)   |
| `[>]` | Migrated to another day  |
| `[-]` | Dropped                  |

The `# Someday` header is matched case-insensitively and rewritten to
`# Someday`.

## Inline tokens

| Token           | Meaning                                        |
|-----------------|------------------------------------------------|
| `@HH:MM`        | Time of day, 24-hour. Fires a notification.    |
| `!YYYY-MM-DD`   | Due date. Feeds the horizon strip.             |
| `~Nd`           | Lead time — days before the due date it appears in the horizon. |
| `>YYYY-MM-DD`   | Where the item went when it was carried forward. |

A token is only a token when it has whitespace or a line boundary on both sides, so
`dana@gotab.io` and `5~10` stay prose. A token whose value is impossible —
`@25:99`, `!2026-02-30` — is left in the text rather than guessed at.

## Notes

A note is a two-space-indented blockquote line under an item:

    - [ ] Review PR #4412
      > ask about the 30s timeout

Consecutive lines join into one note. A blank line ends it. Notes are notes,
not subtasks — there is no nesting.

## The daily note

Everything after the last `---` at the start of a line. Free text, never
parsed.

A `---` you have typed is kept even when nothing follows it yet, so an
unfinished daily note is never removed on save.

## Frontmatter

A file may open with a YAML frontmatter block, the kind Obsidian and most
static site generators write:

    ---
    tags: work
    ---
    # 2026-08-31

    - [ ] thing

The block is preserved exactly and never interpreted. Its closing `---` is
not treated as the daily-note separator. A leading `---` with no closing
`---` is not frontmatter — it is an ordinary rule, and the file is read the
normal way.

## Anything else

Any line the parser does not recognise — tables, prose, links, plain bullets,
blank lines — is preserved exactly as written. The app renders what it
understands and never rewrites the rest.

## Canonical form

When the app writes a file it normalises the lines it understands: tokens in
the order `@time !due ~lead >moved`, `[x]` lowercase, times zero-padded,
notes indented exactly two spaces, no trailing whitespace on item lines, one
trailing newline. Reading and writing a canonical file returns it
byte-for-byte.

Files are read with either LF or CRLF line endings and written with LF. A
leading byte-order mark and blank lines above the header are dropped.
Text inside an item is never reflowed — tabs, non-breaking spaces and
repeated spaces are yours to keep.
