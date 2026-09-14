---
approved: no
---

# A board in the popover

Settles the popover half of phase four item 11, and with it the open question
from phase four spec §8.3 about what the day footer does when its tabs stop
fitting.

Robert asked for it in these words: *"I want access to the kanban board from
the popout day-view. I don't see a tab for it there, only in the detached
window."* Asked what "access" should mean, he chose to draw the board in the
popover rather than open the window on it, **with the columns stacked
vertically** - a drag is up and down through one list, and the page scrolls
itself when the pointer nears an edge. Asked what happens when the tabs stop
fitting, he chose a `...` menu, described by three cases that this spec turns
into one rule.

## 1. The board is a view of the popover

The popover gains board views. `Day` and each board switch what this window
draws; `Week`, `Month` and `Someday` still open the other window, as they do
today. One strip, two kinds of destination - which is already true of the
strip, since `Day` is where you are and the other three are elsewhere.

`dayPage` mounts the same `createBoardView` the spread window uses. One
component, two layouts: a board drawn in two places by two components would be
two things to keep in step, and the divergence would land on the drag - the
part hardest to test and easiest to get subtly wrong.

The day's own parts - the carry band, the horizon strip, the list, the add
row, the sections, the note row, the evidence - move into a `.day-body`
wrapper. Exactly one of that wrapper and the board is on screen. The page
header (date, navigation, pin) stays above both, shared, and the notice band
stays under it: a board that could not be written needs somewhere to say so,
and the pin has to stay reachable, because pinning the popover is what makes a
long drag possible at all.

### Switching to a board snaps the page to today

The board is an arrangement of today and only today, which `.plan/spec.md`
settled and `spread.js` now enforces by hoisting one `today()` per draw. The
popover, unlike the spread window, has a date in its header. Opening a board
while the page shows last Tuesday would put Tuesday's date above an
arrangement of today.

So opening a board tab calls `showing.go(today())`. The header then reads the
day the board is actually about. Switching back to `Day` leaves you on today,
which is where a person who just looked at today's board wants to be.

The board view keeps its own head - the board's name and its card count -
under the shared page header. That is not a duplicate: the header names the
day, the view names the board.

### What is not asked for while a board is up

`boxFor` is not called: nothing draws the day's margin while the board is on
screen, and a question nobody can see the answer to is not worth waking a
plugin for. This is the rule `roomForABox` already applies to a short window,
applied to a hidden one.

`boardsFor` is called only while a board tab is showing, for the same reason
in reverse. Which boards *exist* is read from `store.installed()` on every
draw - that is a config question, not a plugin question - so the tabs are
drawn whether or not any board has been asked anything.

## 2. Vertical is a direction, not a component

`.board-columns` in the popover is `flex-direction: column`, scrolling as one
column of sections rather than sideways through parallel ones. Column names
become `position: sticky; top: 0`, so the name of the section you are in stays
visible while you drag through it.

The drag code needs no change. It finds the drop column with
`closest('.board-column')` and the insertion point with
`closest('.board-card')`; both resolve identically in a stacked layout. The
last column is not a drop target, and "last" is `columns.lastElementChild` -
by position, which is still what it is when the positions run downwards.

The scrolling container moves from each column's own `.board-cards` to the
`.board-columns` stack, which is what makes "the page auto-scrolls" a single
thing to scroll rather than three.

## 3. Auto-scroll

The one genuinely new behaviour. HTML5 drag-and-drop does not scroll a
container under the pointer in WebKit, so a card cannot be dragged to a column
that is off-screen - which, stacked in a 560pt window, is most of them.

A new `src/views/dragScroll.js`, split so the decision is testable without a
browser:

- `scrollStep(top, bottom, y)` - pure. Signed pixels per frame: negative near
  the top edge, positive near the bottom, zero between. Ramps linearly from 0
  at the band's inner limit to `FASTEST` at the edge itself.
- `autoScroll(element)` - attaches `dragover` to record the pointer and
  `dragend`/`drop`/`dragleave` to stop, driving `requestAnimationFrame` while
  a step is non-zero.

`EDGE = 44` and `FASTEST = 14`. The band is clamped to a third of the
container's height on each side, so at the 240pt minimum window the two bands
do not meet and leave no neutral middle.

## 4. The tab strip, and the `...` menu

Robert gave three cases:

1. At minimum width the bar is `DAY WEEK MONTH ...`, with Someday in the menu.
2. When there is room, show Someday **and** one more board.
3. Past five, show `...` and put Someday in it.

These are one rule:

> `Day`, `Week` and `Month` are fixed. `Someday` and the boards are demotable,
> `Someday` first and then the boards from the last backwards. The strip shows
> at most five tabs, and no more than fit. Whatever is demoted goes in `...`.

Each case falls out of it rather than being special-cased. Measured against
the real metrics - 10.5px uppercase, 0.08em tracking, 8px padding each side,
3px gap, a 16px footer gutter, and the open count on the right:

| window | tab budget | strip |
| --- | --- | --- |
| 300pt (minimum) | ~200px | `DAY WEEK MONTH ...` - Someday demoted, and Kanban does not fit either: the three plus Kanban plus `...` needs ~235px |
| 380pt (default) | ~280px | `DAY WEEK MONTH SOMEDAY KANBAN` - ~280px, which fits |
| many boards | any | Someday demoted first, boards fill, the rest in `...` |

The figures above are estimates from the CSS; the implementation measures
rather than assumes, and the table is what the measurement is expected to
agree with rather than a set of constants to hard-code.

### Where each half lives

- `src/core/tabFit.js` - pure. Given tabs in display order with their measured
  widths, a demotion order, the available width, the gap, the `...` button's
  width and the cap, returns which keys are shown and which are hidden. The
  fixed three are simply absent from the demotion order, so if even they do not
  fit the strip clips rather than emptying: a floor has to exist somewhere.
- `src/views/moreMenu.js` - the `...` button and the list it opens above the
  footer. Closes on Escape, on a click outside, and on choosing. Its rows are
  buttons, for the reason the tabs are.
- `src/views/dayFooter.js` - measures each label once and caches by text,
  re-fits on a `ResizeObserver`, and skips the work when neither the width nor
  the set of labels has changed. `render` runs on every keystroke in the add
  row, so an unconditional measure would thrash layout for a strip that has
  not moved.

## 5. Two windows, one board file

Both windows can now show a board at once, and `keepBoards` writes from each.
`inFlight` is module scope - one webview's - so it does not help here.

Two of the three writes are already safe to make twice:

- `mergeBoard` returns the file it was given, byte for byte, when the
  arrangement has not changed, and `keepBoard` writes nothing when it does.
- `stampAll` mints no id for a line that already has one.

`appendArchive` is not. It would write the same card into `archive.md` twice,
and that file is append-only with no watcher behind it, so the duplicate is
permanent and unnoticed - the exact hazard `inFlight`'s own comment names.

So `archiveEnded` filters out cards whose id is already in the archive, using a
new `archivedIds(text)` in `boardFile.js` - the module that owns the archive's
format. This closes the hazard for any number of writers, which is better than
electing one: electing the popover would mean the window's board stops keeping
itself when the popover is put away, and electing the window would mean a board
never seeds unless you open a window you did not want.

## 6. No change in Rust

`plugins::allowed(label, command)` gates plugin webviews only - both app
windows are unrestricted. The popover may ask `spread.board` and may read and
write plugin files exactly as the spread window does. Verified rather than
assumed.

## 7. Tests

Node:

- `tabFit` - Robert's three cases by name, the cap, the floor when the fixed
  three do not fit, and a board list that changes between fits.
- `scrollStep` - zero in the middle, signed at each edge, the ramp, and the
  clamp in a container shorter than two bands.
- `archivedIds`, and `archiveEnded` archiving the same card twice writing once.

Browser:

- The board's tab appears in the popover footer for an installed board plugin,
  and not for a plugin whose name cannot be a vault folder.
- Choosing it draws the stacked board and snaps the header to today.
- The `...` menu opens at a narrowed width and its rows do what their tabs do.
- A card dragged between two stacked columns writes the move.

## Out of scope

- The spread window's board is untouched, other than sharing the archive fix.
- No new plugin question, no new slot, no manifest change.
- `Week`, `Month` and `Someday` still open the other window. Only boards and
  the day are drawn here.
