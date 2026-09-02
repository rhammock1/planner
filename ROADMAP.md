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
   are. The first consumers are outside the vault; the lasting one is the
   notes below, whose files the vault search does not read.

**Run.** Still nothing written to the vault. What is new is a clock, and one
reach outside the sandbox.

4. **`planner.refresh()`.** The host pulls, on popover open, for a range, and
   that is the whole of it. Fine for a calendar, wrong for anything with a
   clock in it. Rate-limited: a plugin that calls it in a loop redraws the
   page in a loop.
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
is a contract and a plugin is not a party to it.

7. **Sidecar files.** A plugin gets a name next to the day it belongs to —
   `2026/09/2026-09-01.meeting-with-daryoush.md` — same folder, same date
   stem, a suffix it chooses, and nothing else. Still Markdown, still
   greppable, still in git. A path outside that shape is refused the way an
   entry that climbs out of its folder already is. Worth landing on its own,
   because both plugins below are built on it.
8. **`meeting-notes`** — a block under the day you type into while a meeting
   happens. Forces `page.section`. The title makes the filename, lowercased
   and kebab-cased; two sources in order, the plugin supplying one when it can
   (a calendar contribution already carries the event text) and asking when it
   cannot. Autosaves through `writeQueue.js`, because there is no Save button
   anywhere else in this app either. This is also where the note question gets
   settled: the app has the `> ` under an item and the daily note after `---`,
   and a meeting note is neither, because a contributed line is not in your
   file.
9. **`task-notes`** — pick a line on the day page and open a page of your own
   about it, and the line carries a marker back to it. Forces `item.action`, a
   plugin adding a *gesture* to a line you wrote, which is a larger grant than
   a badge; the marker pointing back is `item.badge` again, already proven.
   The open question is identity, and it is a real one: `onToggle(index)` says
   a line is its position in the file, so editing the text or dragging it to
   another day orphans a note keyed to it. Three candidates — the kebab-cased
   text, a token in the line, or a content hash in plugin storage — and it
   gets decided before the plugin is written, not during.

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

Two entries that belong here and have no phase:

- **`macos-reminders`**, the second reference plugin (spec §7.5). The point of
  it is not reminders: it is the second consumer of an API that has only ever
  had one, and whatever it cannot do through the public API is a thing the API
  has wrong. Read-only it teaches nothing the calendar has not; two-way —
  ticking it here ticks it there — forces a plugin *proposing* a change your
  file accepts, which is a fork in the road for the whole API and wants its
  own design rather than a place in a queue.
- **A heading that comes from the plugin.** The contributed section is headed
  `On the calendar` because one plugin contributes to it. A second one would
  need the heading to say whose lines those are, which means either a field in
  the manifest or a section per plugin. `git-activity` is that second one, so
  this is answered by phase two whether or not it is picked up before then.

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
  section's heading and a tab's name. Three manifest keys arriving separately
  in three phases is worth watching: if the third looks like the first two,
  they were one thing.
