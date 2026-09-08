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
  const moves = store.pluginMoves()
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
