# Roadmap

What is deliberately not built yet, and why it is worth doing. The order is
roughly the order it should happen in. Anything not on this list and not in
the README is not planned.

## Next

- **Token help while typing** — the four tokens (`@10:30`, `!2026-09-04`,
  `~3d`, `>2026-09-02`) already work anywhere a line is typed, because the
  line is re-parsed on the way to disk. Nothing says so. Two candidates, in
  increasing order of how much app they add:
  1. A preview under the day page's add row, the same one quick add already
     shows: type `Pair with Dana at 4` and read back *Today, 16:00* before
     committing. Reuses `entryPreview.js`; nothing new to learn.
  2. A completion hint when a token character is typed — `@` offers a time,
     `!` a date. Closer to what an editor does, and a bigger step away from a
     ruled page. Worth doing only if (1) turns out not to be enough.

- **Natural language in the day page's add row.** Quick add parses
  `tomorrow at 10:30`; the add row on the page does not, and the difference
  between the two fields is not visible. Held back because the add row has no
  preview to show what was understood — which makes it the same decision as
  the item above.

## After that

- **Editing a line in a week column.** Lines there are read-only: a
  `contenteditable` region takes the press to place a caret, so a column you
  can write in is a column you cannot drag a line out of. Dragging won; the
  day page is where lines are written. A double-click that turns one line
  editable for as long as it has focus would give both, and is the obvious
  shape if it turns out to be missed.
- **Dragging to and from the back page** (spec §5.6). `core/move.js` already
  handles it in both directions and is tested for it; there is just nowhere to
  drop, because the week and the back page are different views of the same
  window. A someday column down the right-hand edge of the week is the obvious
  answer, and a design question rather than a coding one.
- Bundled fonts. Themes name `Newsreader`, `Public Sans` and `IBM Plex Mono`;
  no `woff2` files ship, so all three fall back to Georgia, system-ui and the
  default monospace.

## Plugins

The rule in [docs/plugins.md](docs/plugins.md) decides the order here: a slot
with no consumer is a guess about an API. So this is a list of plugins, not a
list of slots, and the API work under each one is whatever that plugin cannot
do today. A plugin that gets dropped takes its slot with it.

Four phases, each granting one kind of power — **annotate**, **run**,
**write**, **draw**. A plugin that only annotates cannot lose your writing,
which is where the new surfaces get proven. A plugin that draws its own DOM is
the largest grant this API will ever make, which is why it is last.

**Annotate.** Read-only, no new trust.

1. **`ticket-links`** — `Review PR #4412` grows a marker at the end of the
   line that opens the pull request; the pattern and the URL it maps to are
   yours, in the plugin's own config table. Forces `item.badge`, a
   `shell.open` capability whose schemes the manifest declares, and passing a
   plugin its own config — `plan()` hands over `{name, entry, capabilities}`
   and nothing else, so today it cannot be told which repository `#4412` is.
2. **Plugin settings.** `PluginConfig` is `{enabled, approvedCapabilities}`
   and `updatePlugin` writes exactly those two paths, so a plugin with options
   has nowhere to keep them. A `[settings]` schema in the manifest, of the
   shape `settingsFields.js` already drives, rendered under the plugin in the
   ⌘, pane. Second rather than first because `ticket-links` is its first
   consumer, and a schema with nothing to configure is the same guess an empty
   slot is.
3. **Search providers.** `search.provide`, so ⌘F groups hits by whose they
   are. Landed in phase three with `meeting-notes`, its real consumer, rather
   than here: a consumer manufactured for a slot is the guess the rule at the
   top of this section forbids.

**Run.** Still nothing written to the vault. What is new is a clock, and one
reach outside the sandbox.

4. **`planner.refresh()`.** Designed and not built. Neither `git-activity` nor
   `dusk` needed it in the end — one answers from a cache and the other is
   asked again whenever the schedule moves — so it has no consumer, and the
   design is recorded in the phases spec §3.1 so it is not designed twice.
5. **`git-activity`** — where the day went, at a glance, and not a work log:
   the day already has one and it is the daily note you write yourself. One
   line, `pushed 6 commits to gotab-inc/node` or `20 commits by claude in
   rhammock1/hazelnut`. No new slot — it contributes lines exactly as the
   calendar does, which makes it a useful check on whether that slot holds for
   a second kind of thing. Forces a **scoped** `shell.run`: the manifest
   declares the exact command, the ⌘, pane shows that string verbatim, and you
   approve the string rather than the idea of running commands.
6. **`dusk`** — the page warms after sunset and cools at dawn, from where you
   are. Forces `theme.tokens`, a plugin emitting colour over the theme in
   force rather than replacing it, which is what keeps a theme a folder of
   static tokens and makes a plugin the thing that moves them. Sunrise is
   arithmetic from a latitude and a date, so `macos.location.read` is enough
   and **it needs no network** — worth defending, as the precedent for the
   next plugin that thinks it does.

**Write.** Beside your day file, never into it: [docs/format.md](docs/format.md)
is a contract and a plugin is not a party to it. Landed, whole.

7. **Sidecar files.** A plugin gets a name next to the day it belongs to —
   `2026/09/2026-09-01.meeting-with-daryoush.md` — same folder, same date
   stem, a suffix it chooses, and nothing else. Still Markdown, still
   greppable, still in git. A path outside that shape is refused the way an
   entry that climbs out of its folder already is. Worth landing on its own,
   because both plugins below are built on it.
8. **`meeting-notes`** — landed as a block you typed into while a meeting
   happened, then folded into `macos-calendar` once notes moved into a page of
   their own (phase three, part two): its offers came entirely from
   `macos.calendar.read`, so it was never independent enough to keep its own
   manifest and its own tick. The `meeting-` prefix and the sidecars already
   on disk moved with it; `plugins/meeting-notes/` is gone. The slot it forced
   is renamed too, to `page.note` (docs/plugins.md), because it stopped
   drawing anything of its own on the day page. The title still makes the
   filename, lowercased and kebab-cased, from the calendar's own event text —
   and the note question this plugin settled still holds: the app has the
   `> ` under an item and the daily note after `---`, and a meeting note is
   neither, because a contributed line is not in your file.
9. **`task-notes`** — pick a line on the day page and open a page of your own
   about it, and the line carries a marker back to it. Forces `item.action`, a
   plugin adding a *gesture* to a line you wrote, which is a larger grant than
   a badge; the marker pointing back is `item.badge` again, already proven.
   Identity was the open question and it was answered with the kebab of the
   line's words, plus a look-back over the carry-forward window: the plugin
   finds the newest `note-<kebab>` on or before the day being drawn, so a
   carried line keeps its marker and the note stays where it was written.
   Editing the words orphans the marker. If that turns out to be missed, the
   `^abc123` block-ref spec §3.5 reserves is the app's to add, in core, with
   a `format.md` change — not a plugin's.

**Draw.** A box, and the plugin cannot leave it: no pointer events reaching
your lines, no access to page DOM, its own stylesheet.

10. **`pet`** — a creature in the margin that reacts to how the day is going.
    A school assignment notebook has a margin and the margin is where you
    doodle, which is the whole constraint: a plugin may have a box, and the
    box is the margin. **Mockups first** — where it sits, how big, what it
    does at four states of a day; if they say it crowds the popover the slot
    is not built and the phase moves to tabs. Four walls at once, which is
    what makes it the stress test: a boxed `onRender`, `planner.storage` (its
    first real consumer — everything above turned out cheaper to recompute
    than to cache), a heartbeat, and `glance` rather than `vault.read`,
    because `{open, done, overdue}` is what `core/glance.js` already computes
    for the menu bar and may well be enough.
11. **Tabs from a plugin.** `spread.view`, the largest surface in the app and
    last because it is where the sandbox gets genuinely hard. Two
    presentations, because the two windows have different room: the day page
    grows a `…` after Someday that opens a menu of them, and the week and
    month show them plainly alongside the built-in tabs. The first consumer is
    a year-of-days grid, which is where it gets decided whether reading the
    vault is one capability or two — a tab like that wants all of it and the
    day page only ever wanted today.

Three entries that belong here and have no phase:

- **`macos-reminders`**, the second reference plugin (spec §7.5). The point of
  it is not reminders: it is the second consumer of an API that has only ever
  had one, and whatever it cannot do through the public API is a thing the API
  has wrong. Read-only it teaches nothing the calendar has not; two-way —
  ticking it here ticks it there — forces a plugin *proposing* a change your
  file accepts, which is a fork in the road for the whole API and wants its
  own design rather than a place in a queue.
- **`standup-notes`**, and the capability it would force. Twice a week there is
  a standup, and its notes are the same shape every time: what was worked on
  since the last one, and what is still open going into the next. Both are
  already in the vault, and not as a guess — a tick is what got done, a line
  still open and carried is what did not, and a struck-out line is a decision
  that was made. That is the whole of the Monday and Thursday format already
  written down, four days at a time.

  **The association that looks hard is not needed.** A plugin does not have to
  know which tasks *belong to* a meeting, and nothing has to be tagged. The
  meeting's own recurrence is the window: the previous occurrence of an event
  with this title is where the range starts and this one is where it ends, so
  Monday's standup reads Friday to Monday and Thursday's reads Monday to
  Thursday. That comes out of `macos.calendar.read`, which already exists.

  What it does need is the one thing no plugin can do today: **read the days.**
  `vault.sidecar.read` reaches notes beside a day and nothing at all reaches a
  day file, so this is a second consumer of the `vault.read` question phase
  eleven leaves open — and a second consumer is what makes that question safe
  to answer, since one is a guess about an API. The two want different shapes,
  which is exactly the useful part: a year-of-days grid wants the whole vault,
  and this wants four days ending today.

  It drafts; you cut. The plugin names a `standup-` sidecar and the app writes
  it, the same way a meeting note already works, and you edit it before the
  call. Which answers the question that makes this look impossible — how would
  it know which lines are worth saying out loud? It does not, and it does not
  need to. The work it saves is the gathering, not the judgement.

- **A heading that comes from the plugin.** Answered. `git-activity` was the
  second contributor, and `[contribute] heading` (docs/plugins.md) is the
  field: each plugin is drawn under the heading its own manifest asked for, in
  name order. The note-view work gave that field a second use — a contributor
  whose lines carry no time at all folds under the day's own note instead of
  keeping a section, and its heading becomes the small tag on that line
  instead of a full one (the fold rule). `git-activity`'s `From git` is that
  case; `On the calendar` keeps its own section because a meeting carries a
  time.

## Decided against, for now

- Persisting the detached window's size, position and view across a restart,
  for the same reason as the pin below.
- Persisting the pin and the popover's size across a restart. Both survive as
  long as the app runs. A pin that silently outlives a restart is a popover
  that has stopped closing itself for a reason you no longer remember.
- Subtasks, projects, boards, priorities, tags, time tracking. See the end of
  the README: if it does not fit on a ruled page, it belongs in a plugin.
- `net.fetch`. Nothing in the plugin list above needs it — `dusk` looked like
  it did and did not. It gets designed when something genuinely cannot be done
  without it, and not before.
- Extending the token grammar from a plugin. The four tokens are a contract in
  [docs/format.md](docs/format.md), and a file whose meaning depends on which
  plugins you had installed is not a folder of Markdown any more.

## Open questions

- The footer count reads `5 left` (spec §5.1); the original mockup read
  `1 / 6`.
- Spec §5.3 reserves the alert colour for overdue items only; the mockup used
  it for near ones too.
- A crossed-out line stays on the page, dimmed and struck, rather than
  disappearing. That is the "nothing rots" idea — the day records what was
  decided, not only what was done.
- A settings schema is a plugin describing itself, and so are a contributed
  section's heading, a tab's name, and now a gesture's label. Four manifest
  keys arriving separately in four phases is the same shape four times, which
  is past the point of watching for it: they were one thing.
- How one plugin decorates another plugin's contributed line. Merging
  `meeting-notes` into `macos-calendar` answered the meeting case by removing
  it, not by answering it. `ticket-links` on a calendar row is the case that
  brings it back.
- A block region on the day page, removed rather than kept empty. If a plugin
  appears that needs to draw under the day and is not a note, the region
  comes back with that plugin.
