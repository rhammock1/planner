// @ts-check

/**
 * The badge half of asking plugins about a page: what markers land on a
 * page's lines (spec §1.4), and what happens when one is clicked (spec
 * §2.1).
 *
 * Shared by `app.js` and `spread.js` so the notice text and the click's
 * approval check cannot drift between the two windows into two different
 * answers for the same question. Each window still checks independently,
 * against its own store (spec §1.3) - sharing this module does not change
 * that; it only stops the same check being retyped twice.
 */

import { linesOf, badgeKey, readBadges } from '../core/badges.js'
import { mayOpen } from '../core/urls.js'
import * as ipc from '../ipc.js'

/** @typedef {import('../core/badges.js').Badge} Badge */
/** @typedef {import('../store.js').Store} Store */

/**
 * What the plugins have to say about one page's lines.
 *
 * Draw-on-miss: called on every draw, answering with whatever the cache
 * holds right now and asking again if the lines have changed. Never awaited,
 * so a page is never held up by somebody else's code.
 *
 * @param {Store} store
 * @param {string} page
 * @returns {{badges: Map<number, Badge[]>, notices: string[]}}
 */
export function badgesFor(store, page) {
  const lines = linesOf(store.page(page))
  return readBadges(
    store.pluginAnswers('item.badge', badgeKey(page, lines), { date: page, items: lines }),
    lines,
  )
}

/**
 * Opens what a marker points at.
 *
 * Checked here so a refusal is immediate and says why; checked again in
 * Rust, which is the boundary. Not a strike either way: the approval may
 * have changed since the plugin answered.
 *
 * @param {Store} store
 * @param {string} plugin
 * @param {string} href
 * @returns {Promise<void>}
 */
export async function openBadge(store, plugin, href) {
  const approved = store.approvedOpen(plugin)
  if (!mayOpen(href, approved)) {
    store.notice(`${plugin} tried to open ${href}, which is not one of the addresses you approved.`)
    return
  }
  try {
    await ipc.openUrl(plugin, href)
  } catch (error) {
    store.notice(`Could not open that: ${message(error)}`)
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
