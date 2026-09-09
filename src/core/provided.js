// @ts-check

/**
 * `search.provide`: what somebody other than the vault has to say about a
 * query (spec §2.3).
 *
 * ⌘F's results grow groups after the vault's, one per provider, headed by the
 * plugin's name. A provider with nothing has no group, and the summary counts
 * vault hits only - what the vault holds is a fact about your files, and a
 * number that moved because a plugin answered late would be a different kind
 * of claim.
 *
 * An `href` is a `sidecar:` and nothing else. No provider in this design
 * returns a URL, so a URL is dropped rather than opened: the day a provider
 * needs one, it arrives with `shell.open`'s approval rules attached, and not
 * before.
 *
 * Pure. It never sees the DOM, so a hit's text cannot be markup by the time a
 * view has it - the view sets `textContent` and the text is a string.
 */

import { readRef, owns } from './sidecars.js'

/**
 * @typedef {object} Provided
 * @property {string} plugin
 * @property {string} text  one line
 * @property {string|null} date  `YYYY-MM-DD`; a click jumps there
 * @property {string|null} href  a `sidecar:` this plugin owns
 */

/** One line of a result, and no more. Longer is a paragraph, not a hit. */
const LONGEST = 200

/** How many hits one provider gets. Past this the query is the thing to
 *  change, which is the same bargain the vault's own `MOST` makes. */
const MOST = 20

/**
 * @param {{plugin: string, value: unknown}[]} answers
 * @param {Map<string, string[]>} owned  who owns which sidecar prefix
 * @returns {{groups: {plugin: string, hits: Provided[]}[], notices: string[]}}
 */
export function readProvided(answers, owned) {
  /** @type {{plugin: string, hits: Provided[]}[]} */
  const groups = []
  /** @type {string[]} */
  const notices = []

  for (const answer of answers) {
    if (answer.value === null || answer.value === undefined) continue
    if (!Array.isArray(answer.value)) {
      notices.push(`${answer.plugin} returned something that is not a list`)
      continue
    }

    const prefixes = owned.get(answer.plugin) ?? []
    /** @type {Provided[]} */
    const hits = []
    let dropped = 0

    for (const one of answer.value) {
      if (hits.length >= MOST) {
        dropped += 1
        continue
      }
      const hit = readOne(one, answer.plugin, prefixes)
      if (hit === null) {
        dropped += 1
        continue
      }
      hits.push(hit)
    }

    if (dropped > 0) {
      notices.push(`${answer.plugin} sent ${dropped} ${dropped === 1 ? 'result' : 'results'} this app could not read`)
    }
    // Absent rather than empty: a heading over nothing is a group earning its
    // space by lying about having some.
    if (hits.length > 0) groups.push({ plugin: answer.plugin, hits })
  }

  return { groups, notices }
}

/**
 * @param {unknown} raw
 * @param {string} plugin
 * @param {string[]} prefixes
 * @returns {Provided|null}
 */
function readOne(raw, plugin, prefixes) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = /** @type {Record<string, unknown>} */ (raw)

  const text = flatten(fields['text'])
  if (text === '') return null

  const given = fields['date']
  // A date this app cannot read is not worth guessing at, and the line still
  // matched: it shows as a hit you cannot jump from.
  const date = typeof given === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(given) ? given : null

  const pointer = fields['href']
  if (pointer === undefined || pointer === null) return { plugin, text, date, href: null }

  const named = readRef(pointer)
  // Not a sidecar, or not this plugin's: dropped, and the whole hit with it.
  // Half a result - a line you cannot press - would be worse than none, since
  // the reason it is not pressable is invisible.
  if (named === null || !owns(prefixes, named.suffix)) return null
  return { plugin, text, date, href: `sidecar:${named.date}/${named.suffix}` }
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function flatten(raw) {
  if (typeof raw !== 'string') return ''
  const line = raw.replace(/\s+/gu, ' ').trim()
  return line.length <= LONGEST ? line : `${line.slice(0, LONGEST - 1)}…`
}
