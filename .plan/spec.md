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

**`src/spread.js`** - ask about today, write to today, and settle the day once:

- `draw()` (299-371) hoists `const day = today()` at the top.
- `:323` `boardsFor(store, anchor)` becomes `boardsFor(store, day)`.
- `:328` `keepBoards(store, anchor, ..., today())` becomes
  `keepBoards(store, day, ..., day)`.
- `:354` `today: today()` becomes `today: day`.
- The comment above them is rewritten: the board is an arrangement of today,
  and walking back through the weeks does not move it.

The hoist is not tidying. `draw()` currently calls `today()` at 328 and 354
independently and this change would add a third at 323, so a draw that straddles
midnight gets different days from them - an answer computed for one day and a
stamp written into the other day's page. One value per draw makes that
impossible rather than merely caught.

**`src/plugins/boardWrites.js`** - refuse to write to a page that is not today:

`keepBoards(store, page, boards, today)` already receives both, so it returns
without writing when `page !== today`.

This guard is not an assertion about a call site that always passes, and its
comment must not read as one or somebody will delete it as dead code. What it
defends is the midnight straddle above, for any caller that computes the day
more than once - this window after a careless edit, or the next window to ask.
Without it, such a caller stamps ids into the wrong day's page; with it, the
draw writes nothing and the next draw a minute later does the work.

Silent - no notice. Firing means a straddle that the following draw fixes, and
a notice would alarm somebody about something already handled.

**`plugins/kanban/index.js:27`** - the header says "the day the spread window is
anchored on, which is today until somebody navigates". It ships to a person's
machine via `tools/update`, so it has to agree with the code. The kanban session
owns the file and gave the replacement wording, to land in the same commit as
the `spread.js` change so no branch ever carries a plugin and a window that
disagree:

```
 * "The page" is always today. The spread window asks about today whatever
 * week it happens to be showing, so `items` is today's lines and the
 * question's `date` is `now.date`. A task on an older page reaches the board
 * by being carried forward, which leaves the old line `migrated` and the
 * carried copy live - seeding the old line instead would mint a second name
 * for a task that already has one, which is the case `migrated` exists to
 * refuse. `now` is also the clock: a card ages off the board against the
 * actual date, so a board does not un-archive itself because somebody looked
 * at last month.
```

No code change goes with it: `seeds()` reads `items` and never looks at `date`,
so "only today is asked" is a property of the question rather than something the
plugin enforces.

**`docs/plugins.md`** - the `date` paragraph in the `spread.board` section says
`date` is "today until somebody walks back through the weeks". It becomes:
`date` is always today, `now` is the clock, and a task on an older day reaches
the board by being carried forward. The warning comment in the example, which
tells an author that seeding from `items` seeds from whichever day is being
looked at, comes out - it stops being true.

## Tests

- `test/board-writes.test.js`: a board asked about a page that is not today
  writes nothing - no stamp into the day page, no archive append, no board
  write, and no notice. The regression test for both the browsing-writes-files
  defect and the midnight straddle.
- `test/board-writes.test.js`: the existing cases keep passing with `page`
  equal to `today`, which is what they already pass.
- The two-line `spread.js` change is not unit-testable - nothing imports the
  window's entry - which is why the refusal above exists to carry the
  guarantee.

## Not in this change

The `...` menu in the day footer (phase-four spec §8.3) and the two edits to
the gitignored kanban design spec. Both still need Robert.
