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
 * **It returns nothing in daylight.** The app hands a plugin no way to read
 * the theme, so this one carries its own two palettes and interpolates between
 * them. At nought it returns an empty map rather than its day palette, which
 * is what keeps a theme that is not Ledger untouched for the whole of the day
 * and moved only over the hour this plugin exists for.
 */

import { sunEvents, localMinutes, minutesOf, warmthAt, mix, readPlace } from './sun.js'

/** Ledger's own, which is what the page looks like in daylight.
 *  Annotated, because `Object.keys` gives `string[]` and an inferred literal
 *  key type would make `DAY[name]` an implicit-any index below.
 *  @type {Record<string, string>} */
const DAY = {
  'paper': '#FBFAF6',
  'surface': '#F4F2EA',
  'edge': '#D9D6CC',
  'edge-soft': '#E7E4DA',
  'ink': '#23262A',
  'dim': '#8B8981',
}

/** The same page under a lamp. @type {Record<string, string>} */
const NIGHT = {
  'paper': '#F6EEDD',
  'surface': '#EFE6D3',
  'edge': '#D2C4A7',
  'edge-soft': '#E1D4BA',
  'ink': '#2A2622',
  'dim': '#8C8271',
}

/** Where this Mac is, and the day it was worked out on. A laptop does not
 *  move far enough between two questions to matter, but it does between two
 *  days. @type {{on: string, at: {latitude: number, longitude: number}}|null} */
let known = null

planner.on('theme.tokens', async ({ now }) => {
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
  for (const name of Object.keys(DAY)) {
    moved[name] = mix(DAY[name] ?? '', NIGHT[name] ?? '', warmth)
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
