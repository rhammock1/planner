# The vault format

Planner stores one Markdown file per day. The files are the app's data
format and its public interface — everything else is an editor for them.
Edit them by hand, grep them, put them in git.

## Layout

    ~/Planner/
      2026/08/2026-08-31.md    one file per day, created lazily
      someday.md               the back page
      .trash/                                     notes you deleted

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

## A file beside a day

A plugin may ask for a file of its own next to a day, and you type into it:

    2026/09/2026-09-01.md                       the day
    2026/09/2026-09-01.meeting-standup.md       a file beside it

Same folder, same date, then a `.` and a **suffix**: lowercase letters, digits
and single hyphens, at most 64 characters. The part before the first hyphen is
a **prefix**, and a plugin owns the suffixes beginning with the prefixes it
declared — two plugins cannot own the same one.

Such a file is **never parsed**. It is free text, LF, one trailing newline,
never reflowed; nothing in it means anything to this app, and none of the
inline tokens work in it. It is not a day: it holds no items, it is not counted, it
never carries forward, and it does not appear in the week or the month.

Two things reach past that wall, and both stop at reading. The app reads a
sidecar's first `# ` line, to have something to call it in a list. And it may
draw the whole file as Markdown — headings, lists, emphasis, links — when you
open it to read or write it. Neither is parsing: the bytes on disk are exactly
what you typed, drawing one feeds nothing back into it, and a sidecar you have
never opened that way means exactly what it always did.

A link so drawn may open: `http`, `https` and `mailto` only, and only because
you wrote it yourself. That is not the check a plugin's own links get —
[plugins.md](plugins.md) holds a plugin to the addresses its manifest
declared and the pane ticked, and a link in your own note answers to neither,
since that list exists to constrain a plugin's code, not the person whose
vault this is. A `mailto:` loses its query and fragment before it opens, so a
link cannot hand a compose window an attachment you never saw; a link whose
address carries a username — `https://you@evil.io/`, which reads as one host
and resolves to another — is refused, the same as a scheme this app will not
open at all. Anything refused, and anything else typed as a link, is drawn as
text rather than as a link nothing would follow.

The back page has no date, and so has no files beside it.

A plugin never writes one of these. It names one; the app writes it, atomically,
the same way it writes a day.

Deleting one does not erase it. The file moves to `.trash/` at the vault root,
its name gaining a third part — the second it was deleted, so deleting the
same suffix twice does not collide:

    .trash/2026-09-01.meeting-standup.1757520000.md

Still a plain file, still in git, still greppable. It keeps its date and its
suffix, carries the second it was deleted, and — like the sidecar it was — is
never listed, never carried forward, and never counted. Nothing offers to open
it again.

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
| `^abc123`       | The line's name. The app writes this one; see below. |

A token is only a token when it has whitespace or a line boundary on both sides, so
`dana@gotab.io` and `5~10` stay prose. A token whose value is impossible —
`@25:99`, `!2026-02-30` — is left in the text rather than guessed at.

## The line's name

    - [ ] Firmware sign-off !2026-09-02 ~10d ^k4m2qa

`^` and six lowercase letters and digits, last on the line. It is a name for
the line, so that something outside the file — a board, a plugin's list — can
point at it and still be pointing at it tomorrow.

**The app writes these, you don't.** One is stamped at the moment something
starts referring to a line, and at no other moment: not when a day is drawn,
not when a plugin is asked about a page, not when a file is saved. A vault
nothing points into holds none of them, and opening a day to look at it never
writes a byte.

**A name moves with its line.** When a line is carried forward or dragged to
another day, the name travels to the new line and comes off the `[>]` line left
behind — so a week of carrying leaves one named line, not seven. The `>` token
is what chains those days together, and it still does.

**Two lines may end up with one name anyway.** Copy a line in your editor and
you copy its name with it; restore a file from a backup and you reinstate a
name that has since moved on. Nothing is corrupt when that happens. Whatever is
looking a name up takes the one on the most recent page, and reads `[>]` as
*moved*, not as *done*.

Delete one by hand and you make the line anonymous, which is a fine thing to
do: whatever was pointing at it says so, and nothing is thrown away on your
behalf.

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

## Anything else in the folder

A vault may hold Markdown that is neither a day nor a file beside one —
`A-RUMBLING-OF-THUNDER.md` at the root, say. Such a file is ignored entirely:
not indexed, not counted, never carried forward, and absent from the week, the
month and the horizon. Nothing in it is parsed.

The app will open one by name — `planner <path>.md` — and read its first `# `
line to have something to call it in the window. That is the same single
exception already made for a file beside a day, for the same reason.

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
