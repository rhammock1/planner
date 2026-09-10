// @ts-check

/**
 * `item.action`: the gesture a plugin adds to a line you picked, and what the
 * app does with the answer (spec §4.3).
 *
 * Two separable things, together because they are one story. `readActions`
 * believes an answer - a plugin may name a file, and only one beginning with
 * a prefix it owns. `routeTo` decides what naming it *means*: which day to
 * show, and whether a file has to be made.
 *
 * The second is the rule that keeps a plugin from writing where you are not
 * looking. An action carries a date, and a plugin picks it; the app makes a
 * file only when that date is the page on screen. A ref for any other day has
 * to be a note that already exists - which is exactly the case the look-back
 * produces, and nothing else.
 *
 * Pure. Neither function sees the DOM, the store, or a clock.
 */

import { readRef, owns } from './sidecars.js'

/** A file a plugin asked the app to show, once it has been believed.
 *  @typedef {{plugin: string, date: string, suffix: string}} Opening */

/** What showing it takes: a day to go to first, and whether to make the file.
 *  @typedef {{go: string|null, create: boolean}} Route */

/**
 * The files the plugins asked to open.
 *
 * A list, though this version takes it only when it holds one. Spec §4.3 has
 * a pick list under the line when two plugins offer an action; there is one
 * action plugin in existence, so the list is not drawn - and the answer stays
 * a list so that drawing it later is a view rather than a rewrite.
 *
 * @param {{plugin: string, value: unknown}[]} answers
 * @param {Map<string, string[]>} owned  who owns which prefix
 * @returns {{openings: Opening[], notices: string[]}}
 */
export function readActions(answers, owned) {
  /** @type {Opening[]} */
  const openings = []
  /** @type {string[]} */
  const notices = []

  for (const answer of answers) {
    // Nothing to open, which is not the same as the wrong shape: a handler
    // with no note for this line is answering, and a person pressing a chord
    // on a line nothing has anything to say about should see no complaint.
    if (answer.value === null || answer.value === undefined) continue

    const opening = readOne(answer.value, answer.plugin, owned.get(answer.plugin) ?? [])
    if (opening === null) {
      // One notice per answer, like everywhere else (spec §6). There is only
      // ever one thing here to drop, so there is nothing to count.
      notices.push(`${answer.plugin} answered with something this app could not open`)
      continue
    }
    openings.push(opening)
  }

  return { openings, notices }
}

/**
 * @param {unknown} raw
 * @param {string} plugin
 * @param {string[]} prefixes
 * @returns {Opening|null}
 */
function readOne(raw, plugin, prefixes) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = /** @type {Record<string, unknown>} */ (raw)

  const open = fields['open']
  if (typeof open !== 'string') return null

  const ref = readRef(open)
  if (ref === null) return null

  // The whole of the prefix rule, at the one place this slot names a file.
  // Spec §4.1: every `sidecar:` href, from any slot, is checked against the
  // answering plugin's prefixes - and a plugin with no `[sidecars]` table has
  // none, which is what the empty list below means.
  if (!owns(prefixes, ref.suffix)) return null

  return { plugin, date: ref.date, suffix: ref.suffix }
}

/**
 * Where a ref sends you, and whether a file has to be made first.
 *
 * `null` is a refusal, and there is exactly one: a file that is not there, on
 * a day that is not the one on screen. Making it would put a note in the
 * vault on a day nobody is looking at, and showing it would move the page out
 * from under a chord that was about a line here.
 *
 * @param {{date: string, suffix: string}} ref
 * @param {string} page  the day on screen
 * @param {boolean} exists  whether the file is there - a definite read, not a listing
 * @returns {Route|null}
 */
export function routeTo(ref, page, exists) {
  if (exists) return { go: ref.date === page ? null : ref.date, create: false }
  if (ref.date === page) return { go: null, create: true }
  return null
}
