---
approved: no
---

# The board is an arrangement of today

Settles the open question from phase four item 11: which day seeds a
`spread.board` plugin's board.

## The decision

**Today seeds the board, and only today.** A task on an older day reaches the
board by being carried forward, which the app already does and which leaves the
old page correctly marked `migrated`. There is no second door: no "add this to
the board?" offer on a past day.

Robert decided both halves (2026-09-14). The reasoning for refusing the offer
is that a card seeded from a page you have moved past is exactly the `migrated`
case `readCard` already refuses - its twin on the later day is the live one -
so an offer would either mint a second name for one task or be carrying with
extra steps. If carrying ever proves too slow, the fix is to make carrying
easier, not to give the board its own door.

## What is wrong today

`src/spread.js:323` asks `boardsFor(store, anchor)` and `:328` passes the same
`anchor` to `keepBoards`. `anchor` moves whenever somebody walks back through
the weeks. Two consequences, and the second is the one that matters:

1. The board redraws as an arrangement of whatever day is being looked at.
2. `unnamed` and `stampNames` stamp `^abc123` into whatever page is anchored,
   and add that page's open lines to the board. From a person's side, browsing
   old weeks silently writes to old day files.

The comment justifying the anchor says the anchored day is "the one a card
dragged onto it would land on". No such gesture exists: the board's drag moves
a card between columns and writes `board.md` alone. The justification was
speculative and nothing depends on it.

## The change

**`src/spread.js`** - ask about today, and write to today:

- `:323` `boardsFor(store, anchor)` becomes `boardsFor(store, today())`.
- `:328` `keepBoards(store, anchor, ...)` becomes `keepBoards(store, today(), ...)`.
- The comment above them is rewritten: the board is an arrangement of today,
  and walking back through the weeks does not move it.

**`src/plugins/boardWrites.js`** - refuse to write to a page that is not today:

`keepBoards(store, page, boards, today)` already receives both, so it returns
without writing when `page !== today`. This is the half that can be tested, and
it makes the guarantee structural rather than a property of one call site: a
future caller that passes an anchor stamps nothing into an old day page.

**`plugins/kanban/index.js:27`** - the header says "the day the spread window is
anchored on, which is today until somebody navigates". It becomes: the page is
always today. This file belongs to the kanban session; it ships to a person's
machine via `tools/update`, so it has to agree with the docs.

**`docs/plugins.md`** - the `date` paragraph in the `spread.board` section says
`date` is "today until somebody walks back through the weeks". It becomes:
`date` is always today, `now` is the clock, and a task on an older day reaches
the board by being carried forward. The warning comment in the example, which
tells an author that seeding from `items` seeds from whichever day is being
looked at, comes out - it stops being true.

## Tests

- `test/board-writes.test.js`: a board asked about a page that is not today
  writes nothing - no stamp into the day page, no archive append, no board
  write. The regression test for the browsing-writes-files defect.
- `test/board-writes.test.js`: the existing cases keep passing with `page`
  equal to `today`, which is what they already pass.
- The two-line `spread.js` change is not unit-testable - nothing imports the
  window's entry - which is why the refusal above exists to carry the
  guarantee.

## Not in this change

The `...` menu in the day footer (phase-four spec §8.3) and the two edits to
the gitignored kanban design spec. Both still need Robert.
