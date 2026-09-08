// @ts-check

/**
 * What `dusk` does to a page, and what it promises not to do to one.
 *
 * The walk at the bottom is the reason this file exists. `nightfall` is a pure
 * function of the theme's tokens and the sun, which is what lets a test afford
 * to run it for every minute of a whole day, at four latitudes, on a light
 * theme and a dark one - and assert that the list never stops being readable.
 * That promise is the whole design; a page that went unreadable for eleven
 * minutes at civil dusk would be a bug nobody would ever catch by looking.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { nightfall, skyAt, legibility, LONGEST } from '../plugins/dusk/palette.js'
import { solarPosition } from '../plugins/dusk/sun.js'
import { contrast, luminance } from '../plugins/dusk/colour.js'
import { forbidden, LEDGER, TOKEN_NAMES } from '../src/core/theme.js'
import { readPluginTokens, LONGEST as APP_LONGEST } from '../src/core/tokens.js'
import { readManifest, slotOptions, optionNames } from '../src/core/manifest.js'
import { readFileSync } from 'node:fs'

/** Ledger, as the question hands it over. */
const LIGHT = Object.fromEntries(LEDGER.tokens)

/** A theme that is already a night page. Nothing here should invert it.
 *  @type {Record<string, string>} */
const DARK = {
  ...LIGHT,
  paper: '#14161B', surface: '#1B1E24', edge: '#333842', 'edge-soft': '#23272F',
  ink: '#E4E6EA', dim: '#8A9099', accent: '#5FBFA8', alert: '#E07A5F',
  texture: 'none',
}

/**
 * What the manifest actually declares, read the way the app reads it. The
 * ceiling on everything below: a name the plugin moves and did not declare is
 * refused on the page rather than painted.
 */
const DECLARED = optionNames(
  slotOptions(readManifest(readFileSync('plugins/dusk/manifest.toml', 'utf8')), 'theme.tokens'),
  'moves',
)

const CHARLOTTE = { latitude: 35.23, longitude: -80.84 }

/**
 * The sun at an altitude, made up rather than looked up - most of what is
 * checked below is a fact about a degree rather than about a Tuesday.
 *
 * @param {number} altitude  degrees
 * @param {number} [azimuth]  degrees, west by default
 * @returns {{altitude: number, azimuth: number}}
 */
const sunAt = (altitude, azimuth = 270) => ({ altitude, azimuth })

test('in daylight there is nothing to move, and an empty map moves nothing', () => {
  // Absent rather than a day palette: this plugin moves colours, and in
  // daylight there is nothing to move. An empty map leaves the theme alone
  // rather than restating it.
  assert.deepEqual(nightfall(LIGHT, sunAt(40)), {})
  assert.deepEqual(nightfall(LIGHT, sunAt(6)), {})
  assert.deepEqual(nightfall(LIGHT, sunAt(6.5)), {})
})

test('a moment it could not read is not a colour', () => {
  assert.deepEqual(nightfall(LIGHT, null), {})
})

test('through twilight the surfaces move and the marks are held', () => {
  // The promise the design rests on: nothing gets harder to read before the
  // turn. The ink does not travel - but the paper under it does, and a
  // contrast is a fact about a pair, so a mark with nothing spare has to be
  // held or it goes out. Ledger's `dim` is 3.4:1 on Ledger's own paper and
  // would be 1.9:1 on the paper of last light.
  for (const altitude of [5, 2, 0, -3, -5.9]) {
    const dusk = nightfall(LIGHT, sunAt(altitude))
    // The ink is the one mark with room to spare - 14:1 at noon, and still
    // over 9 on the paper of last light - so it is never touched before the
    // turn, and the turn is the only place this plugin inverts anything.
    assert.equal(dusk['ink'], undefined, `the ink moved at ${altitude} degrees`)

    for (const name of ['dim', 'accent', 'alert']) {
      const held = dusk[name] ?? LIGHT[name] ?? ''
      const want = Math.min(contrast(LIGHT[name] ?? '', LIGHT['paper'] ?? ''), 4.5)
      const seen = contrast(held, dusk['paper'] ?? '')
      assert.ok(
        seen >= want - 0.01,
        `${name} fell to ${seen.toFixed(2)}:1 at ${altitude} degrees, under its own ${want.toFixed(2)}`,
      )
    }
    // 7:1 is the promise; the floor over the whole of twilight is 8.3, which
    // is the paper of last light under ink that never moved.
    assert.ok(
      legibility(LIGHT, dusk) >= 7,
      `the list read at ${legibility(LIGHT, dusk).toFixed(2)}:1 at ${altitude} degrees`,
    )
  }
})

test('a theme the deepening only helps is left entirely alone', () => {
  // A dark theme's paper going darker raises every ratio on the page, so the
  // holding above is a thing that never has to happen and nothing but the
  // surfaces is answered.
  assert.deepEqual(
    Object.keys(nightfall(DARK, sunAt(-3))).sort(),
    ['edge', 'edge-soft', 'paper', 'surface', 'texture'],
  )
})

test('at civil dusk the page turns over, in one step', () => {
  const before = nightfall(LIGHT, sunAt(-5.9))
  const after = nightfall(LIGHT, sunAt(-6.1))

  assert.equal(before.ink, undefined, 'the ink moved before the lamp')
  assert.ok(after.ink !== undefined, 'the lamp came on and the ink stayed put')

  // Light ink on a dark page, where a moment earlier it was the other way up.
  assert.ok(luminance(before.paper ?? '') > 0.25, 'last light was already a night page')
  assert.ok(luminance(after.paper ?? '') < 0.06, 'the night page was not dark')
  assert.ok(luminance(after.ink ?? '') > 0.6, 'the night ink was not light')

  // And it is a cut, not a crossing: neither side is near the middle.
  assert.ok(contrast(LIGHT['ink'] ?? '', before.paper ?? '') > 6)
  assert.ok(contrast(after.ink ?? '', after.paper ?? '') > 7)
})

test('a theme that is already a night page is never turned over', () => {
  // Inverting a dark theme would turn the lamp on by making the room
  // brighter. It gets the deepening and the sky and keeps its own ink.
  const deep = nightfall(DARK, sunAt(-9))
  assert.equal(deep.ink, undefined)
  assert.equal(deep.accent, undefined)
  assert.ok(deep.paper !== undefined)
  assert.ok(
    luminance(deep.paper ?? '') <= luminance(DARK['paper'] ?? ''),
    `a dark paper was lightened to ${deep.paper}`,
  )
})

test('the sky is a table, read in order and clamped at both ends', () => {
  // Above the top row is daylight and below the bottom is night; in between,
  // the horizon reddens and then goes out.
  assert.equal(skyAt(90).horizon, skyAt(40).horizon)
  assert.equal(skyAt(-90).horizon, skyAt(-50).horizon)
  assert.ok(luminance(skyAt(2).horizon) > luminance(skyAt(-6).horizon))
  assert.ok(luminance(skyAt(-6).horizon) > luminance(skyAt(-18).horizon))
})

test('the light comes in from the edge the sun is behind', () => {
  // Bearing across the page: east at 0%, south at 50%, west at 100%. This is
  // the half of the answer version 0.1.0 never had.
  const west = nightfall(LIGHT, sunAt(-2, 275)).texture ?? ''
  const east = nightfall(LIGHT, sunAt(-2, 85)).texture ?? ''
  const westAt = Number(/at (-?\d+)%/.exec(west)?.[1])
  const eastAt = Number(/at (-?\d+)%/.exec(east)?.[1])
  assert.ok(westAt > 90, `a western sun lit the page at ${westAt}%`)
  assert.ok(eastAt < 10, `an eastern sun lit the page at ${eastAt}%`)
})

test('a theme with no texture of its own is not given a layer of nothing', () => {
  const dusk = nightfall({ ...LIGHT, texture: 'none' }, sunAt(-2))
  assert.ok(!(dusk.texture ?? '').includes('none'))
})

test('a theme with a long texture keeps the sky rather than the dot grid', () => {
  // A sky dropped whole for being one character over the cap would be no sky
  // at all, so the theme's own layer is the one to give up.
  const long = 'repeating-linear-gradient(180deg, transparent 0 27px, #C4D0DE 27px 28px)'
  const wordy = { ...LIGHT, texture: [long, long, long, long].join(', ') }
  const dusk = nightfall(wordy, sunAt(-2))
  assert.ok((dusk.texture ?? '').length <= LONGEST, `it came to ${(dusk.texture ?? '').length}`)
  assert.ok((dusk.texture ?? '').startsWith('radial-gradient'))
  assert.ok(!(dusk.texture ?? '').includes('repeating-linear-gradient'))
})

test('every value this plugin can produce is one the app will take', () => {
  // Walked rather than sampled: `texture` is assembled from a table, two
  // bearings and three ramps, and it is the one value long enough and
  // structured enough to go wrong.
  const declared = new Map([['dusk', DECLARED]])
  for (const theme of [LIGHT, DARK]) {
    for (let altitude = 10; altitude >= -30; altitude -= 0.25) {
      for (const azimuth of [5, 85, 180, 275, 355]) {
        const moved = nightfall(theme, sunAt(altitude, azimuth))
        for (const [name, value] of Object.entries(moved)) {
          assert.ok(TOKEN_NAMES.includes(name), `${name} is not a token`)
          assert.equal(forbidden(value), null, `${name} at ${altitude}: ${value}`)
          assert.ok(value.length <= LONGEST, `${name} at ${altitude} ran to ${value.length}`)
        }
        // And the app agrees, through the reader that actually decides.
        const read = readPluginTokens([{ plugin: 'dusk', value: moved }], declared)
        assert.deepEqual(read.notices, [], `at ${altitude} degrees, ${azimuth}`)
        assert.equal(read.tokens.size, Object.keys(moved).length)
      }
    }
  }
})

test('the cap the plugin composes against is the cap the app enforces', () => {
  // Two numbers that must agree and cannot be shared: a plugin runs in its own
  // origin and imports nothing from `src/`. So the drift is caught here rather
  // than by a sky that silently stops being drawn.
  assert.equal(LONGEST, APP_LONGEST)
})

test('a theme this file cannot read is left exactly as it was written', () => {
  // `theme.js` checks what could escape a CSS rule, not what shape a colour
  // is, so all of these are legal for `paper`. Read positionally, `white` is
  // #000000 - the plugin then never turns the page over and walks the paper
  // down to meet ink that is already dark, and the theme spends every night as
  // black text on a black page.
  for (const paper of ['white', 'rgb(255,255,255)', '#fffff']) {
    const theme = { ...LIGHT, paper }
    for (const altitude of [3, -1, -6, -9, -20]) {
      assert.deepEqual(
        nightfall(theme, sunAt(altitude)), {},
        `paper "${paper}" was rearranged at ${altitude} degrees`,
      )
    }
  }
})

test('a colour written short is a colour, and still turns the page over', () => {
  // `#fff` is the likeliest thing a theme author types, and the one that used
  // to come back as a red page.
  const short = { ...LIGHT, paper: '#fff', ink: '#222' }
  const dusk = nightfall(short, sunAt(-3))
  assert.ok(luminance(dusk.paper ?? '') < luminance('#fff'))
  assert.ok(contrast('#222', dusk.paper ?? '') > 7)

  const night = nightfall(short, sunAt(-9))
  assert.ok(night.ink !== undefined, 'a short-hex theme was never turned over')
  assert.ok(contrast(night.ink ?? '', night.paper ?? '') >= 7)
})

test('a theme whose accent cannot be read keeps its own ink instead', () => {
  // Last light is the safe half: the theme's own dark ink on a paper that
  // never got dark enough to need lifting. Better than a turn that would have
  // to invent an accent.
  const odd = { ...LIGHT, accent: 'rebeccapurple' }
  const dusk = nightfall(odd, sunAt(-12))
  assert.equal(dusk.ink, undefined)
  assert.equal(dusk.accent, undefined)
  assert.ok(dusk.paper !== undefined, 'it gave up the sunset as well')
  assert.ok(contrast(LIGHT['ink'] ?? '', dusk.paper ?? '') > 7)
})

test('the sky arrives rather than appearing', () => {
  // Every ramp in the plugin is eased so that nothing lands with an edge on
  // it - which is undone if a ramp starts higher than the altitude the plugin
  // starts answering at. The glow used to arrive at a fifth of its strength in
  // the single step across the gate.
  const gate = nightfall(LIGHT, sunAt(5.999)).texture ?? ''
  const alphas = [...gate.matchAll(/#[0-9a-f]{6}([0-9a-f]{2})/g)].map((m) => parseInt(m[1] ?? 'ff', 16))
  assert.ok(alphas.length >= 2, `no layers to read in ${gate}`)
  assert.ok(Math.max(...alphas) <= 2, `the sky arrived at alpha ${Math.max(...alphas)} of 255`)
})

test('the light never crosses the page in one minute', () => {
  // A bearing is a circle, and a line laid on a circle breaks somewhere. Laid
  // the obvious way it breaks at due north - and the sun passes through due
  // north during twilight every summer night above about 66 degrees, which is
  // a real place on a real evening rather than a synthetic input.
  let previous = null
  let worst = 0
  for (let minute = 0; minute < 1440; minute += 1) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
    const sun = solarPosition('2026-07-25', time, 70, 0)
    const texture = nightfall(LIGHT, sun).texture
    if (texture === undefined) { previous = null; continue }
    const at = Number(/at (-?\d+)%/.exec(texture)?.[1])
    if (previous !== null) worst = Math.max(worst, Math.abs(at - previous))
    previous = at
  }
  assert.ok(worst <= 6, `the glow moved ${worst}% of the page between two minutes`)
})

test('the manifest declares everything the plugin actually moves, and no more', () => {
  // Both ways round. A name it moves and did not declare is refused on the
  // page; a name it declared and never moves is a tick asking for nothing.
  const declared = new Set(DECLARED)
  const moved = new Set()
  for (const theme of [LIGHT, DARK]) {
    for (let altitude = 10; altitude >= -30; altitude -= 0.5) {
      for (const name of Object.keys(nightfall(theme, sunAt(altitude)))) moved.add(name)
    }
  }
  assert.deepEqual([...moved].sort(), [...declared].sort())
})

test('the list stays readable at every minute of a whole day, everywhere', () => {
  // The promise. A whole day a minute at a time, on a light theme and a dark
  // one, from the tropics to inside the Arctic circle - including the day
  // Longyearbyen never gets light, which is the case 0.1.0 refused to answer.
  //
  // 4.5:1 is the floor rather than the aim: through twilight the ink does not
  // move at all and the figure stays in double digits, and after the turn it
  // is over 7 by construction. What this catches is any future ramp that
  // walks the paper into its own ink.
  const places = [
    { latitude: 0, longitude: 0 },
    CHARLOTTE,
    { latitude: 51.48, longitude: 0 },
    { latitude: 78.22, longitude: 15.65 },
  ]

  for (const date of ['2026-03-20', '2026-06-21', '2026-09-08', '2026-12-21']) {
    for (const place of places) {
      for (const theme of [LIGHT, DARK]) {
        let worst = { ratio: 21, at: '', what: '' }
        let worstMark = { ratio: 21, at: '', what: '' }
        for (let minute = 0; minute < 1440; minute += 1) {
          const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
          const sun = solarPosition(date, time, place.latitude, place.longitude)
          const moved = nightfall(theme, sun)
          const where = `${date} ${time} at ${place.latitude}`

          const ratio = legibility(theme, moved)
          if (ratio < worst.ratio) worst = { ratio, at: where, what: 'ink' }

          // The rest of the promise, measured against what the theme itself
          // chose rather than against a number: `dim` is meant to be quiet,
          // and Ledger's is 3.4:1 by design. What is forbidden is *losing*
          // contrast, not having little of it.
          const paper = moved['paper'] ?? theme['paper'] ?? ''
          for (const name of ['accent', 'alert', 'dim']) {
            const mark = moved[name] ?? theme[name] ?? ''
            const want = Math.min(contrast(theme[name] ?? '', theme['paper'] ?? ''), 4.5)
            const kept = contrast(mark, paper) / want
            if (kept < worstMark.ratio) {
              const seen = contrast(mark, paper).toFixed(2)
              worstMark = { ratio: kept, at: `${where}, ${name} at ${seen}:1`, what: name }
            }
          }
        }
        // 7:1 is what the design promises for the list; the measured floor
        // over this walk is above 8, so the assertion has room and a drift
        // toward the middle shows up here rather than on somebody's page.
        assert.ok(worst.ratio >= 7, `${worst.what} read at ${worst.ratio.toFixed(2)}:1 on ${worst.at}`)
        // As a fraction of what the mark had on the theme's own paper: one is
        // "exactly as readable as its author left it", and anything under one
        // is this plugin having taken something away.
        assert.ok(
          worstMark.ratio >= 0.99,
          `${worstMark.what} kept ${(worstMark.ratio * 100).toFixed(0)}% of its own contrast - ${worstMark.at}`,
        )
      }
    }
  }
})
