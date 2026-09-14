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
import { BOARD, boardLinesOf, boardKey, readBoard } from '../core/board.js'
import { vaultFolder } from '../core/plugins.js'
import { readSections, sectionKey } from '../core/sections.js'
import { boxQuestion, readBox, paints } from '../core/box.js'
import { readProvided } from '../core/provided.js'
import { owns } from '../core/sidecars.js'
import { mayOpen } from '../core/urls.js'
import * as ipc from '../ipc.js'

/** @typedef {import('../core/badges.js').Badge} Badge */
/** @typedef {import('../core/provided.js').Provided} Provided */
/** @typedef {import('../core/board.js').Answer} Answer */
/** One plugin's board: its tab, its file as it stands, and what it last said
 *  about the day. @typedef {{plugin: string, tab: string, board: string, answer: Answer|null}} Board */
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
 * The picture in the day's margin, if a plugin draws one.
 *
 * Draw-on-miss like the two above. The key is the whole question written out -
 * the day, the four counts, the five colours - because those are the only
 * things the answer can depend on, so a key made of them asks again exactly
 * when the picture could have changed and never otherwise. The clock is
 * deliberately not in it: a creature that redrew itself every minute would be
 * asking a plugin sixty times an hour for the same drawing.
 *
 * `sizes` comes from the manifests rather than from the answers: how much of
 * the page a plugin takes is a thing it declares and you tick, not a thing it
 * decides per drawing (spec §1.1).
 *
 * @param {Store} store
 * @param {string} page  `YYYY-MM-DD`
 * @param {import('../core/glance.js').DayGlance} glance
 * @param {Map<string, string>} tokens  what the window is wearing
 * @returns {{box: import('../core/box.js').Box|null, notices: string[]}}
 */
export function boxFor(store, page, glance, tokens) {
  const question = boxQuestion(page, glance, paints(tokens))
  const key = [
    page,
    glance.open, glance.done, glance.due, glance.overdue,
    ...Object.values(question.theme),
    // The separator `asking.js` already uses for a compound key, because a
    // theme value is somebody else's string and may hold anything a colour
    // may hold - including whatever else might have been picked here.
  ].join('\u0000')

  return readBox(
    store.pluginAnswers('page.box', key, question),
    new Map(store.installed().map((one) => [one.name, one.box])),
  )
}

/**
 * The plugins that keep a board, in the order `installed` lists them.
 *
 * A board is kept in the plugin's folder in the vault, so a plugin whose name
 * cannot be a folder has nowhere to keep one. `plan` has already said so in
 * the pane (spec §2.5); here it is simply not a tab.
 *
 * Exported because both windows draw a strip of these tabs before anything has
 * been asked of anybody - a tab exists because a manifest says so, not because
 * a plugin answered - and a strip filtered one way while the question was
 * asked another would be a tab that opens an empty board.
 *
 * @param {Store} store
 * @returns {import('../core/installed.js').Installed[]}
 */
export function boardPlugins(store) {
  return store.installed().filter((one) =>
    one.enabled
    && one.approvedSlots.includes('spread.board')
    && vaultFolder(one.name) !== null)
}

/**
 * What each board plugin makes of the day in front of you (spec §2.2).
 *
 * One entry per plugin that keeps a board, in the order `installed` lists
 * them, so a strip of tabs is drawn in a settled order and two launches put
 * the same tab first. A plugin that has not answered yet is still in the list
 * with a null answer: its tab exists because its manifest says so, and a tab
 * that appeared only once its plugin had replied would appear late and move
 * the ones beside it.
 *
 * The board *file* goes out in a `per` table, keyed by plugin name, for the
 * reason `sectionsFor` sends sidecars that way: the envelope merges only the
 * asking plugin's entry and drops the rest, so no plugin is ever shown
 * another's board (`waiting.rs`).
 *
 * One question for all of them, not one each. The cache holds every answer to
 * a slot under one key, so a key per plugin would ask every board plugin once
 * per board plugin and file each round of answers under the wrong question.
 * The key is therefore every board's own key joined: it changes exactly when
 * one of them would have changed, and never otherwise.
 *
 * Draw-on-miss like the rest, and the file is read the same way: `pluginFile`
 * answers null until the read lands and redraws the window when it does.
 *
 * @param {Store} store
 * @param {string} page  `YYYY-MM-DD`
 * @returns {{boards: Board[], notices: string[]}}
 */
export function boardsFor(store, page) {
  const lines = boardLinesOf(store.page(page))

  const keeping = boardPlugins(store)
  if (keeping.length === 0) return { boards: [], notices: [] }

  /** @type {Map<string, string>} */
  const files = new Map(keeping.map((one) => [one.name, store.pluginFile(one.name, BOARD) ?? '']))
  /** @type {Record<string, {board: string}>} */
  const per = {}
  for (const [name, board] of files) per[name] = { board }

  const key = keeping
    .map((one) => `${one.name}:${boardKey(page, lines, files.get(one.name) ?? '')}`)
    // `boxFor`'s separator, for `boxFor`'s reason, written as an escape for
    // `board.js`'s: the byte may go through a key and may not sit in a file
    // this repo tracks.
    .join('\u0000')
  const answers = store.pluginAnswers('spread.board', key, { date: page, items: lines, per })

  /** @type {Board[]} */
  const boards = []
  /** @type {string[]} */
  const notices = []
  for (const one of keeping) {
    const mine = answers.find((answer) => answer.plugin === one.name)
    const read = readBoard(mine?.value ?? null, lines)
    for (const line of read.notices) notices.push(`${one.tab}: ${line}`)
    boards.push({
      plugin: one.name,
      tab: one.tab,
      board: files.get(one.name) ?? '',
      answer: read.answer,
    })
  }

  return { boards, notices }
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
