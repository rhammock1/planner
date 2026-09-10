// @ts-check

/**
 * Asking plugins about the page in front of you: what markers land on its
 * lines (spec §1.4, §2.1), and what blocks go under it (spec §4.2).
 *
 * Shared by `app.js` and `spread.js` so the notice text and the click's
 * approval check cannot drift between the two windows into two different
 * answers for the same question - though only the day page asks for blocks,
 * because the spread has no sections (spec §2.3). Each window still checks
 * independently, against its own store (spec §1.3) - sharing this module
 * does not change that; it only stops the same check being retyped twice.
 */

import { linesOf, badgeKey, readBadges } from '../core/badges.js'
import { readSections, sectionKey } from '../core/sections.js'
import { readProvided } from '../core/provided.js'
import { owns } from '../core/sidecars.js'
import { mayOpen } from '../core/urls.js'
import * as ipc from '../ipc.js'

/** @typedef {import('../core/badges.js').Badge} Badge */
/** @typedef {import('../core/provided.js').Provided} Provided */
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
 * The blocks that go under this day.
 *
 * Each plugin is told which of *its* sidecars exist for the day, and no
 * plugin is told about another's - which is why the question carries a `per`
 * table keyed by plugin name rather than one list of everything (spec §4.2).
 * The split is made here because this is the language that reads the
 * manifests and settles who owns which prefix.
 *
 * Draw-on-miss, exactly as `badgesFor` is: called on every draw, answering
 * with whatever the cache holds and asking again when the day's files change.
 *
 * @param {Store} store
 * @param {string} page  `YYYY-MM-DD`
 * @returns {{blocks: import('../core/sections.js').Block[], notices: string[]}}
 */
export function sectionsFor(store, page) {
  const existing = new Map(store.sidecarsOn(page).map((one) => [one.suffix, one.title]))
  const owned = store.pluginPrefixes()

  /** @type {Record<string, {sidecars: {suffix: string, title: string}[]}>} */
  const per = {}
  for (const [plugin, prefixes] of owned) {
    per[plugin] = {
      sidecars: [...existing.entries()]
        .filter(([suffix]) => owns(prefixes, suffix))
        .map(([suffix, title]) => ({ suffix, title })),
    }
  }

  // The generation is in the key because a block's *offers* come from
  // somewhere with a clock in it - a calendar, in `macos-calendar` - so opening
  // the popover has to ask again (spec §1.4).
  const key = `${sectionKey(page, existing)}:${store.pluginGeneration()}`
  return readSections(
    store.pluginAnswers('page.note', key, { date: page, per }),
    existing,
    owned,
  )
}

/**
 * What the plugins have to say about a search query (spec §2.3).
 *
 * The query is the cache key: an answer for a query the field no longer holds
 * is simply a cache entry nobody asks for. Shared by the two windows because
 * the question it builds and the answer it reads are one contract, not two.
 *
 * @param {Store} store
 * @param {string} query
 * @returns {{groups: {plugin: string, hits: Provided[]}[], notices: string[]}}
 */
export function providedFor(store, query) {
  return readProvided(store.pluginAnswers('search.provide', query, { query }), store.pluginPrefixes())
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
