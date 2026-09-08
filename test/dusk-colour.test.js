// @ts-check

/**
 * `dusk`'s colour arithmetic.
 *
 * The two that matter are `shifted`, which is what lets one plugin deepen a
 * theme it has never seen, and `legible`, which is what turns the promise
 * about the list from a hope into a guarantee.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mix, shifted, alpha, luminance, contrast, legible, readable, readColour, ramp, ease,
} from '../plugins/dusk/colour.js'

test('a colour between two colours', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0), '#000000')
  assert.equal(mix('#000000', '#FFFFFF', 1), '#ffffff')
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080')
  assert.equal(mix('#FBFAF6', '#F6EEDD', 0), '#fbfaf6')
})

test('a colour moves the way the reference pair moves, whatever theme it came from', () => {
  // On the reference theme the transformation lands exactly on the reference
  // destination, so nothing about Ledger is a surprise; on a dark theme it
  // deepens without lightening.
  assert.equal(shifted('#FBFAF6', '#FBFAF6', '#D8B9B4'), '#d8b9b4')

  // A dark theme's paper stays dark - the giveaway that this is a ratio and
  // not a difference, which would have lightened it toward Ledger's cream.
  const dark = shifted('#141414', '#FBFAF6', '#D8B9B4')
  assert.ok(luminance(dark) < luminance('#141414'), `a dark paper became ${dark}`)
  assert.ok(luminance(dark) > 0, 'a dark paper went out altogether')

  // And a channel cannot leave the byte it lives in.
  assert.equal(shifted('#EEEEEE', '#23262A', '#2A2622').slice(1, 3), 'ff')
  assert.equal(shifted('#000000', '#FBFAF6', '#D8B9B4'), '#000000')
})

test('an opacity is two more hex digits, and cannot leave the byte', () => {
  assert.equal(alpha('#9a3a57', 1), '#9a3a57ff')
  assert.equal(alpha('#9a3a57', 0), '#9a3a5700')
  assert.equal(alpha('#9a3a57', 0.5), '#9a3a5780')
  assert.equal(alpha('#9a3a57', 4), '#9a3a57ff')
  assert.equal(alpha('#9a3a57', -1), '#9a3a5700')
})

test('contrast against pairs whose ratio is published', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF')), 21)
  assert.equal(contrast('#123456', '#123456'), 1)
  // Ledger, as it ships: dark ink on cream paper.
  assert.ok(contrast('#23262A', '#FBFAF6') > 14)
  // And the pair the whole design exists to avoid.
  assert.ok(contrast('#808080', '#7F7F7F') < 1.1)
})

test('legible walks a colour off a ground it cannot be read on', () => {
  // Toward white over a dark ground, toward black over a light one, and only
  // as far as it has to go.
  const onNight = legible('#17605B', '#22263C', 4.5)
  assert.ok(contrast(onNight, '#22263C') >= 4.5, `reached only ${contrast(onNight, '#22263C')}`)
  assert.ok(luminance(onNight) > luminance('#17605B'), 'it went the wrong way over a dark ground')

  const onDay = legible('#D8D8D8', '#FBFAF6', 4.5)
  assert.ok(contrast(onDay, '#FBFAF6') >= 4.5)
  assert.ok(luminance(onDay) < luminance('#D8D8D8'), 'it went the wrong way over a light ground')
})

test('legible leaves a colour that already reads exactly where it is', () => {
  // The theme's own hue survives as far as it can, which is the point of
  // moving rather than choosing.
  assert.equal(legible('#23262A', '#FBFAF6', 7), '#23262A')
})

test('legible reads the ground rather than halving it', () => {
  // The case a luminance threshold gets wrong. Mid-grey has a relative
  // luminance of about 0.22, which is well under a half - so "dark ground,
  // go toward white" sends the ink the worse way: white on mid-grey is
  // 3.9:1 and black on it is 5.3:1. The direction is measured, not guessed.
  const grey = '#808080'
  assert.ok(contrast('#000000', grey) > contrast('#ffffff', grey), 'the fixture stopped being awkward')

  const found = legible('#7C7C7C', grey, 4.5)
  assert.ok(contrast(found, grey) >= 4.5, `reached only ${contrast(found, grey).toFixed(2)}`)
  assert.ok(luminance(found) < luminance(grey), `it went toward white, to ${found}`)
})

test('legible gives the best available answer rather than a bad one', () => {
  // 21:1 is only reachable between black and white, so asking for it against
  // mid-grey cannot be satisfied. What comes back has to be the most readable
  // colour there is against that ground - asserting merely that it beat the
  // colour it started from would have passed while it returned the *worse* of
  // the two ends.
  const grey = '#808080'
  const best = Math.max(contrast('#ffffff', grey), contrast('#000000', grey))
  const forced = legible(grey, grey, 21)
  assert.ok(
    contrast(forced, grey) >= best,
    `settled for ${contrast(forced, grey).toFixed(2)} where ${best.toFixed(2)} was available`,
  )
})

test('a colour this file cannot do arithmetic on is not a colour', () => {
  // The values `theme.js` lets a theme write. Read positionally, `white` comes
  // back as #000000 and the whole plugin quietly concludes the page is already
  // black - so these have to fail rather than parse into something plausible.
  for (const value of ['white', 'rgb(255,255,255)', 'oklch(0.9 0.02 90)', '', '#', '#12345', 'none']) {
    assert.equal(readColour(value), null, `${value} was read as a colour`)
    assert.equal(readable(value), false, `${value} was called readable`)
  }
})

test('a colour written short, long, or with an alpha on it', () => {
  // `#fff` is the likeliest thing a theme author actually types, and the one
  // that used to come back as a red page.
  assert.deepEqual(readColour('#fff'), [255, 255, 255])
  assert.deepEqual(readColour('#FFFFFF'), [255, 255, 255])
  assert.deepEqual(readColour('#1a2b3c'), [0x1a, 0x2b, 0x3c])
  assert.deepEqual(readColour('#abc'), [0xaa, 0xbb, 0xcc])
  assert.deepEqual(readColour(' #abc '), [0xaa, 0xbb, 0xcc])
  // An alpha is dropped: this is being asked what colour something is.
  assert.deepEqual(readColour('#1a2b3c80'), [0x1a, 0x2b, 0x3c])
  assert.deepEqual(readColour('#abcd'), [0xaa, 0xbb, 0xcc])
})

test('a ramp is nought below, one above, and straight between', () => {
  assert.equal(ramp(-10, 0, 10), 0)
  assert.equal(ramp(0, 0, 10), 0)
  assert.equal(ramp(5, 0, 10), 0.5)
  assert.equal(ramp(10, 0, 10), 1)
  assert.equal(ramp(40, 0, 10), 1)
  // Negative bounds are the ones this plugin actually uses: altitude runs
  // downward through the interesting part of the evening.
  assert.equal(ramp(0, -6, 6), 0.5)
  // A bound against itself is a step rather than a division by nought.
  assert.equal(ramp(4, 5, 5), 0)
  assert.equal(ramp(5, 5, 5), 1)
})

test('an eased ramp keeps its ends and loses its corners', () => {
  assert.equal(ease(0), 0)
  assert.equal(ease(1), 1)
  assert.equal(ease(0.5), 0.5)
  // Flat at both ends: the first and last steps of a linear ramp asked once a
  // minute are the two you can see.
  assert.ok(ease(0.05) < 0.05)
  assert.ok(ease(0.95) > 0.95)
  // And monotone, so a page redrawn a minute later never goes back the way it
  // came.
  let last = -1
  for (let at = 0; at <= 1.0001; at += 0.02) {
    const now = ease(at)
    assert.ok(now >= last, `eased backwards at ${at}`)
    last = now
  }
})
