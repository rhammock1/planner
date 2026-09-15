// @ts-check
// See the note at the top of `test/board-writes.test.js`: checked under
// `tsconfig.web.json`, because the module this imports also exports the frame
// loop that wires `scrollStep` to an element, and that half is DOM. The test
// itself runs under `node --test` with no browser, which is the point of the
// split.
/// <reference types="node" />

/**
 * `scrollStep` in `src/views/dragScroll.js` (spec §3): how far a container
 * moves in one frame while a card is held over it.
 *
 * The whole of the decision is arithmetic over four numbers, so it is checked
 * here with no browser at all. What is left in `autoScroll` - a frame loop and
 * three listeners - is wiring, and is exercised by the board's own browser
 * test rather than mocked out here.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { scrollStep, EDGE, FASTEST } from '../src/views/dragScroll.js'

/** A container taller than three bands, so both bands are the full `EDGE`. */
const TOP = 0
const BOTTOM = 600

test('a card held in the middle does not scroll the container', () => {
  assert.equal(scrollStep(TOP, BOTTOM, 300), 0)
})

test('and the middle is everywhere outside the two bands', () => {
  // The band's inner limit is still the middle: at exactly `EDGE` in, nothing
  // moves, so the neutral region is closed at both ends.
  assert.equal(scrollStep(TOP, BOTTOM, TOP + EDGE), 0)
  assert.equal(scrollStep(TOP, BOTTOM, BOTTOM - EDGE), 0)
  assert.equal(scrollStep(TOP, BOTTOM, TOP + EDGE + 1), 0)
  assert.equal(scrollStep(TOP, BOTTOM, BOTTOM - EDGE - 1), 0)
})

test('at the top edge the container scrolls up, at the bottom down', () => {
  // The sign is the direction the content moves under the card, which is what
  // `scrollTop` takes: negative is towards the first column.
  assert.equal(scrollStep(TOP, BOTTOM, TOP), -FASTEST)
  assert.equal(scrollStep(TOP, BOTTOM, BOTTOM), FASTEST)
})

test('the speed ramps across the band rather than switching on', () => {
  // Half a band in is half speed, so the hand can hold a card still against a
  // slow scroll while reading what is going past.
  assert.equal(scrollStep(TOP, BOTTOM, TOP + EDGE / 2), -Math.round(FASTEST / 2))
  assert.equal(scrollStep(TOP, BOTTOM, BOTTOM - EDGE / 2), Math.round(FASTEST / 2))

  // Deeper is faster, all the way in, and never faster than `FASTEST`.
  const depths = [EDGE - 1, (EDGE / 4) * 3, EDGE / 2, EDGE / 4, 0]
  const speeds = depths.map((depth) => scrollStep(TOP, BOTTOM, TOP + depth))
  for (let at = 1; at < speeds.length; at += 1) {
    assert.ok(
      (speeds[at] ?? 0) <= (speeds[at - 1] ?? 0),
      `${depths[at]}px in scrolled ${speeds[at]}, less than ${depths[at - 1]}px in at ${speeds[at - 1]}`,
    )
  }
  assert.equal(Math.min(...speeds), -FASTEST)
})

test('and a card just inside the band still moves it by a pixel', () => {
  // The ramp never rounds down to standing still: a band with a dead strip at
  // its inner edge is a band you cannot tell you are in.
  assert.equal(scrollStep(TOP, BOTTOM, TOP + EDGE - 0.5), -1)
  assert.equal(scrollStep(TOP, BOTTOM, BOTTOM - EDGE + 0.5), 1)
})

test('a pointer past an edge is treated as being at that edge', () => {
  // `dragover` only fires over the element, so this is a rounding case rather
  // than a real position - and answering it at full speed is one less dead
  // spot than answering it with zero.
  assert.equal(scrollStep(TOP, BOTTOM, -400), -FASTEST)
  assert.equal(scrollStep(TOP, BOTTOM, BOTTOM + 400), FASTEST)
})

test('a container shorter than two bands keeps a middle that does not move', () => {
  // Without the clamp, an 80px container would be two 44px bands overlapping:
  // every position would scroll, including the one being aimed at.
  const short = 60
  assert.equal(scrollStep(0, short, short / 2), 0)
  assert.equal(scrollStep(0, short, 0), -FASTEST)
  assert.equal(scrollStep(0, short, short), FASTEST)

  // A point that would sit inside both bands if the bands were `EDGE` wide.
  assert.equal(scrollStep(0, short, 25), 0)
})

test('and the band is a third of it, so the ramp still spans the whole band', () => {
  const short = 60
  const band = short / 3
  assert.equal(scrollStep(0, short, band), 0)
  assert.equal(scrollStep(0, short, band / 2), -Math.round(FASTEST / 2))
})

test('a container with no height does not scroll', () => {
  // Laid out but not shown, or measured before the page has one. Nothing is
  // over it and there is nowhere to go.
  assert.equal(scrollStep(100, 100, 100), 0)
  assert.equal(scrollStep(100, 40, 60), 0)
})

test('the container is measured where it is, not from zero', () => {
  // The board's columns sit below a header, so `top` is not 0 and the band has
  // to travel with it.
  assert.equal(scrollStep(120, 720, 420), 0)
  assert.equal(scrollStep(120, 720, 120), -FASTEST)
  assert.equal(scrollStep(120, 720, 720), FASTEST)
})
