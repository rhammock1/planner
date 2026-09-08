// @ts-check

/**
 * What the plugins have to say about the page's colours (spec §3.3).
 *
 * Shared by `app.js` and `spread.js` so the two windows cannot drift into two
 * different answers about the same clock. Each still asks for itself, against
 * its own store - sharing this module does not change that; it only stops the
 * same three lines being retyped twice.
 *
 * Generation-forced rather than draw-on-miss: the key steps at the quarter
 * hour and moves when the popover opens or the schedule refreshes, so a page
 * left pinned across sunset warms up in four steps instead of holding the
 * colour it opened with.
 */

import { tokenKey, readPluginTokens, pluginTokensCss } from '../core/tokens.js'
import { styleElement, setText } from '../ui/dom.js'
import { today, nowTime } from '../clock.js'

/** @typedef {import('../store.js').Store} Store */

/**
 * Asks, applies whatever has come back, and hands over anything to say.
 *
 * Never awaited. The page draws with what the cache holds and is drawn again
 * when an answer lands - a page that waited for a plugin to decide its
 * colours would be a page that waited for a plugin.
 *
 * @param {Store} store
 * @returns {string[]} notices
 */
export function applyPluginTokens(store) {
  const now = { date: today(), time: nowTime() }
  const read = readPluginTokens(
    store.pluginAnswers('theme.tokens', tokenKey(now, store.pluginGeneration()), {}),
    store.pluginMoves(),
  )
  // `setText`, not `textContent`: assigning to `textContent` replaces the
  // node, and replacing a `<style>` element's text node makes the browser
  // throw the sheet away and parse it again. `draw()` runs on every keystroke
  // in the add row, in both windows. `setText` writes only when the string
  // actually differs, which on almost every draw is not at all.
  setText(styleElement('theme-plugin'), pluginTokensCss(read.tokens))
  return read.notices
}
