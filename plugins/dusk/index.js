// @ts-check

/**
 * dusk — the page warms after sunset and cools again at dawn.
 *
 * A reference plugin, and the design's own test: it is written against the
 * public API with no privilege the API does not grant (spec §7.5).
 *
 * Two things about it are worth reading for.
 *
 * **It never touches the network.** Sunrise and sunset are arithmetic on a
 * date and two numbers (`sun.js`), and the two numbers come from a capability
 * or from a settings row. The next plugin that thinks it needs `net.fetch`
 * probably needs a setting.
 *
 * **It moves the theme it is given, rather than replacing it.** The question
 * carries the theme's own tokens, so what this plugin ships is not a palette
 * but a *transformation*: how far each channel travels from daylight to
 * lamplight, applied to whatever colour the theme actually set. On Ledger that
 * arithmetic comes out at the destination named below; on any other theme it
 * warms that theme instead of overwriting it with this one.
 *
 * **It returns nothing in daylight.** At nought there is nothing to move, and
 * an empty map leaves the theme alone rather than restating it.
 */

import { sunEvents, localMinutes, minutesOf, warmthAt, mix, shifted, readPlace } from './sun.js'

/**
 * The reference pair, per token: Ledger in daylight, and the same page under a
 * lamp. One row rather than two maps, because a name present in one and
 * missing from the other is then not a thing that can be written down - and
 * because this row is what `manifest.toml`'s `moves` list has to agree with.
 *
 * @type {readonly [string, string, string][]}
 */
const RAMP = [
  ['paper', '#FBFAF6', '#F6EEDD'],
  ['surface', '#F4F2EA', '#EFE6D3'],
  ['edge', '#D9D6CC', '#D2C4A7'],
  ['edge-soft', '#E7E4DA', '#E1D4BA'],
  ['ink', '#23262A', '#2A2622'],
  ['dim', '#8B8981', '#8C8271'],
]

/** Where this Mac is, and the day it was worked out on. A laptop does not
 *  move far enough between two questions to matter, but it does between two
 *  days. @type {{on: string, at: {latitude: number, longitude: number}}|null} */
let known = null

planner.on('theme.tokens', async ({ now, tokens }) => {
  const at = await placeOn(now.date)
  const events = sunEvents(now.date, at.latitude, at.longitude)
  // A day with no sunrise or no sunset in it has no dusk to interpolate over,
  // and this plugin has nothing honest to say about one.
  if (events === null) return {}

  const warmth = warmthAt(
    minutesOf(now.time),
    localMinutes(now.date, events.sunrise),
    localMinutes(now.date, events.sunset),
  )
  // Absent rather than a day palette: this plugin moves colours, and in
  // daylight there is nothing to move.
  if (warmth <= 0) return {}

  /** @type {Record<string, string>} */
  const moved = {}
  for (const [name, day, night] of RAMP) {
    // The theme's own value is the one being moved. The reference stands in
    // for a theme that somehow has no such token: warming a colour nobody set
    // is better than answering with nothing for it.
    const current = tokens[name] ?? day
    moved[name] = mix(current, shifted(current, day, night), warmth)
  }
  return moved
})

/**
 * Where this Mac is, asked once a day.
 *
 * The setting wins, because somebody who typed one in meant it - and because
 * it is what makes this plugin work on a Mac whose location services are off.
 * Otherwise macOS is asked, and the first ask fails while the prompt is up:
 * that rejection becomes a notice on the page saying so, and the answer
 * arrives the next time the page is drawn.
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {Promise<{latitude: number, longitude: number}>}
 */
async function placeOn(date) {
  if (known !== null && known.on === date) return known.at

  const typed = readPlace(String(planner.settings.location ?? ''))
  if (typed !== null) {
    known = { on: date, at: typed }
    return typed
  }

  const at = await planner.capability('macos.location.read').location()
  known = { on: date, at }
  return at
}
