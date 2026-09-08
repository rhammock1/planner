// @ts-check

/**
 * What the plugins have to say about the page's colours (spec §3.3).
 *
 * Shared by `app.js` and `spread.js` so the two windows cannot drift into two
 * different answers about the same clock. Each still asks for itself, against
 * its own store - sharing this module does not change that; it only stops the
 * same three lines being retyped twice.
 *
 * The key steps at the minute and moves when the popover opens or the
 * schedule refreshes, so a page left pinned across sunset follows the sky
 * rather than holding the colour it opened with. Nothing else in this app
 * needs a minute; this module holds the clock that gives one, and only while
 * some plugin has actually claimed a colour.
 */

import { tokenKey, readPluginTokens, pluginTokensCss } from '../core/tokens.js'
import { styleElement, setText } from '../ui/dom.js'
import { today, nowTime } from '../clock.js'

/** @typedef {import('../store.js').Store} Store */

/**
 * What is on the page now.
 *
 * Held between draws, and that is the whole point of it. Asking with a new key
 * is a cache miss, and a miss answers `[]` while the question is in flight -
 * so painting what came back would blank every token for a frame and put it
 * straight back. On the two slots that answer with lists a missing answer is
 * invisible, because a list that is not there yet simply has no lines in it.
 * A token map is a *replacement* of what the page is wearing, so the same
 * miss is a white flash - four times an hour through dusk, and once more
 * every time the popover is opened.
 *
 * Module-level rather than per-store because a window is a document: the two
 * windows load their own copy of this file and never share one.
 *
 * @type {Map<string, string>}
 */
let painted = new Map()

/**
 * The clock, when there is anything for it to be a clock for.
 *
 * A minute is finer than everything else this app is driven by: the alarm
 * thread wakes at the quarter hour, and that is the resolution of the *alarm*
 * rather than one that colour has to be held to. A slot whose whole subject is
 * the passage of light cannot say anything in four steps an hour that does not
 * read as four jumps.
 *
 * A timeout re-armed against the wall clock each tick rather than an interval,
 * so it stays on the minute across a throttle or a sleep - a hidden webview's
 * timers are slowed to about this period anyway, and an interval that drifted
 * would land the page's colours a little later every hour.
 *
 * @type {ReturnType<typeof setTimeout>|null}
 */
let ticking = null

/**
 * Asks, applies whatever has come back, and hands over anything to say.
 *
 * Never awaited. The page draws with what the cache holds and is drawn again
 * when an answer lands - a page that waited for a plugin to decide its
 * colours would be a page that waited for a plugin.
 *
 * It also arms and disarms the minute clock, from the draw that already asks
 * the question. That is why `redraw` is here rather than in a `start()` of its
 * own: there is then no order for a window to get wrong, and enabling or
 * switching off a `theme.tokens` plugin already causes the draw that notices.
 *
 * @param {Store} store
 * @param {() => void} redraw  called on the turn of each minute
 * @returns {string[]} notices
 */
export function applyPluginTokens(store, redraw) {
  const now = { date: today(), time: nowTime() }
  const moves = store.pluginMoves()
  keepClock(moves.size > 0, redraw)
  // The theme's own tokens travel with the question: a plugin is asked to
  // move the theme's colours, and it cannot move what it was never shown.
  const answers = store.pluginAnswers('theme.tokens', tokenKey(now, store.pluginGeneration()), {
    tokens: Object.fromEntries(store.themeTokens()),
  })
  const read = readPluginTokens(answers, moves)

  // Nobody left to answer is not the same as nobody having answered yet. With
  // no claim standing - every such plugin switched off, or put away - what is
  // on the page has to come off, or a plugin's colours would outlive it.
  const waiting = moves.size > 0 && answers.length === 0
  if (!waiting) painted = read.tokens

  // `setText`, not `textContent`: assigning to `textContent` replaces the
  // node, and replacing a `<style>` element's text node makes the browser
  // throw the sheet away and parse it again. `draw()` runs on every keystroke
  // in the add row, in both windows. `setText` writes only when the string
  // actually differs, which on almost every draw is not at all.
  setText(styleElement('theme-plugin'), pluginTokensCss(painted))
  return read.notices
}

/**
 * Starts the minute clock while somebody is claiming a colour, and stops it
 * when nobody is.
 *
 * Idempotent, because it is called from every draw. A vault with no
 * `theme.tokens` plugin in it never holds a timer at all.
 *
 * @param {boolean} wanted
 * @param {() => void} redraw
 * @returns {void}
 */
function keepClock(wanted, redraw) {
  if (!wanted) {
    if (ticking !== null) clearTimeout(ticking)
    ticking = null
    return
  }
  if (ticking !== null) return

  const tick = () => {
    // Re-armed before the draw, so a draw that throws does not stop the clock
    // for the rest of the session - and caught, because an exception escaping
    // a timer would otherwise do it again every minute until the app is
    // relaunched. The next tick is the retry.
    ticking = setTimeout(tick, untilNextMinute())
    try {
      redraw()
    } catch (error) {
      console.error('the page could not be redrawn on the minute', error)
    }
  }
  ticking = setTimeout(tick, untilNextMinute())
}

/**
 * Milliseconds to the top of the next minute, with a little after it.
 *
 * The margin matters: fired exactly on the boundary, `nowTime()` can still
 * read the minute that is ending, and the key would not move - so the page
 * would wait a whole minute for a question it had already decided to ask.
 *
 * @returns {number}
 */
function untilNextMinute() {
  const now = new Date()
  return 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 250
}
