// @ts-check

/**
 * `page.section`: the blocks a plugin puts under the day, and what it may
 * name (spec §4.2).
 *
 * A plugin is shown which of *its* sidecars exist for the day and answers
 * with the blocks it wants, in order. A suffix that exists is an editor; one
 * that does not is an offer, with the title the plugin gave it; one outside
 * the plugin's prefixes is dropped and counted, because a plugin naming
 * another plugin's file is the one thing prefixes exist to stop.
 *
 * The title of a file that exists comes from the file, never from the answer.
 * A plugin cannot rename somebody's note by answering with a different one.
 *
 * Pure. It never sees the DOM, so a title cannot be markup by the time a view
 * has it - the view sets `textContent` and the title is a string.
 */

import { isSuffix, owns } from './sidecars.js'

/**
 * @typedef {object} Block
 * @property {string} plugin  who asked for it, which is whose file it is
 * @property {string} suffix
 * @property {string} title  from the file when there is one, else the answer's
 * @property {'editor'|'offer'} kind
 */

/**
 * How many blocks one plugin may put under a day.
 *
 * A day with a dozen meetings is a day, and a day with forty is a plugin
 * taking the page. Past this they are dropped and counted, like anything else
 * that will not fit.
 */
const MOST = 12

/**
 * The longest a title may be. Mirrors the cut in
 * `src-tauri/src/vault_io/sidecars.rs`, so a title that came off disk and a
 * title that came from a plugin are cut in the same place.
 */
const LONGEST = 80

/**
 * The blocks that go under this day.
 *
 * @param {{plugin: string, value: unknown}[]} answers
 * @param {Map<string, string>} existing  every sidecar on the day, suffix to title
 * @param {Map<string, string[]>} owned  who owns which prefix
 * @returns {{blocks: Block[], notices: string[]}}
 */
export function readSections(answers, existing, owned) {
  /** @type {Block[]} */
  const blocks = []
  /** @type {string[]} */
  const notices = []

  for (const answer of answers) {
    // Nothing to say, which is not the same as the wrong shape: a handler
    // that returned nothing is answering, it just has no blocks this time.
    if (answer.value === null || answer.value === undefined) continue
    if (!Array.isArray(answer.value)) {
      notices.push(`${answer.plugin} returned something that is not a list`)
      continue
    }

    const prefixes = owned.get(answer.plugin) ?? []
    const seen = new Set()
    let dropped = 0

    for (const one of answer.value) {
      if (seen.size >= MOST) {
        dropped += 1
        continue
      }
      const block = readOne(one, answer.plugin, prefixes, existing)
      if (block === null || seen.has(block.suffix)) {
        dropped += 1
        continue
      }
      seen.add(block.suffix)
      blocks.push(block)
    }

    // Counted, not listed, and one notice per answer (spec §6).
    if (dropped > 0) {
      notices.push(`${answer.plugin} sent ${dropped} ${dropped === 1 ? 'block' : 'blocks'} this app could not read`)
    }
  }

  return { blocks, notices }
}

/**
 * @param {unknown} raw
 * @param {string} plugin
 * @param {string[]} prefixes
 * @param {Map<string, string>} existing
 * @returns {Block|null}
 */
function readOne(raw, plugin, prefixes, existing) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = /** @type {Record<string, unknown>} */ (raw)

  const suffix = fields['suffix']
  if (typeof suffix !== 'string' || !isSuffix(suffix)) return null
  // The whole of the prefix rule, at the one place a plugin names a file.
  if (!owns(prefixes, suffix)) return null

  const onDisk = existing.get(suffix)
  if (onDisk !== undefined) {
    return { plugin, suffix, title: flatten(onDisk) || suffix, kind: 'editor' }
  }

  // An offer is a line on the page saying what pressing it will make. With no
  // title there is nothing to write on it, so there is no offer.
  const title = flatten(fields['title'])
  if (title === '') return null
  return { plugin, suffix, title, kind: 'offer' }
}

/**
 * What makes an old answer wrong.
 *
 * The day, and the sidecars on it with their titles - which is exactly what
 * the question carries. Not the page: a keystroke in the daily note changes
 * the page and not one word of what the plugin was shown (spec §1.4).
 *
 * A note's title is in the key, so editing a note's first `# ` heading also
 * rebuilds its block - the same "not seen this exact answer before" mechanism
 * that a new sidecar appearing relies on, just triggered by a keystroke in a
 * file rather than by one arriving. Rarer in practice than the autosave case
 * (`sidecarStore.js`'s `on`) because a heading is edited far less often than
 * the body under it, and left as is: the fix there is what stops the block
 * being torn down while it holds focus, and this path goes through the same
 * fix.
 *
 * @param {string} date
 * @param {Map<string, string>} existing
 * @returns {string}
 */
export function sectionKey(date, existing) {
  const named = [...existing.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `${date}:${named.map(([suffix, title]) => `${suffix} ${title}`).join('\u0000')}`
}

/**
 * One line, cut where Rust cuts it.
 *
 * Code points rather than UTF-16 units, because the string this measures came
 * off disk through `title_of` in `src-tauri/src/vault_io/sidecars.rs`, which
 * counts `chars()`. Measured differently, an astral title Rust had already
 * cut would be cut a second time - an ellipsis after an ellipsis, and the
 * slice landing inside a surrogate pair.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function flatten(raw) {
  if (typeof raw !== 'string') return ''
  const line = raw.replace(/\s+/gu, ' ').trim()
  const points = [...line]
  return points.length <= LONGEST ? line : `${points.slice(0, LONGEST - 1).join('')}…`
}
