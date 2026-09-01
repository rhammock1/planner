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
- Plugins and the two reference plugins (spec §9)
- Notifications and the menu bar badge
- Search
- A settings pane, so `config.toml` is not the only way in
- Bundled fonts. Themes name `Newsreader`, `Public Sans` and `IBM Plex Mono`;
  no `woff2` files ship, so all three fall back to Georgia, system-ui and the
  default monospace.

## Decided against, for now

- Persisting the detached window's size, position and view across a restart,
  for the same reason as the pin below.
- Persisting the pin and the popover's size across a restart. Both survive as
  long as the app runs. A pin that silently outlives a restart is a popover
  that has stopped closing itself for a reason you no longer remember.
- Subtasks, projects, boards, priorities, tags, time tracking. See the end of
  the README: if it does not fit on a ruled page, it belongs in a plugin.

## Open questions

- The footer count reads `5 left` (spec §5.1); the original mockup read
  `1 / 6`.
- Spec §5.3 reserves the alert colour for overdue items only; the mockup used
  it for near ones too.
- A crossed-out line stays on the page, dimmed and struck, rather than
  disappearing. That is the "nothing rots" idea — the day records what was
  decided, not only what was done.
