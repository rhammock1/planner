// @ts-check

/**
 * dusk - the sky, on the page.
 *
 * A reference plugin, and the design's own test: it is written against the
 * public API with no privilege the API does not grant (spec §7.5).
 *
 * Three things about it are worth reading for.
 *
 * **It never touches the network.** Where the sun is comes out of arithmetic
 * on a date, a time and two numbers (`sun.js`), and the two numbers come from
 * a capability or from a settings row. The next plugin that thinks it needs
 * `net.fetch` probably needs a setting.
 *
 * **It moves the theme it is given, rather than replacing it.** The question
 * carries the theme's own tokens, so what this plugin ships is not a palette
 * but a *transformation*: the surfaces travel the ratio a reference pair
 * travels, and the night page is built out of the theme's own two colours. On
 * a theme it has never seen it deepens that theme; on one that is already dark
 * it leaves the ink where it found it, because there is nothing to hand over.
 *
 * **It answers for the minute it was asked about.** The app asks a
 * `theme.tokens` plugin once a minute while a window is open, so the curve is
 * this plugin's own to draw rather than something the app has to smooth. That
 * is also what lets the turn at civil dusk be a single step - see
 * `palette.js`, where the whole of the opinion lives.
 *
 * Everything below is the API and the location. Nothing here decides a colour.
 */

import { solarPosition, readPlace } from './sun.js'
import { nightfall } from './palette.js'

/** Where this Mac is, and the day it was worked out on. A laptop does not
 *  move far enough between two questions to matter, but it does between two
 *  days. @type {{on: string, at: {latitude: number, longitude: number}}|null} */
let known = null

planner.on('theme.tokens', async ({ now, tokens }) => {
  const at = await placeOn(now.date)
  return nightfall(tokens, solarPosition(now.date, now.time, at.latitude, at.longitude))
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
