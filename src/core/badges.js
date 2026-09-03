// @ts-check

/**
 * `item.badge`: the one thing an annotating plugin reads, and what it may put
 * back (spec §2.1).
 *
 * A plugin is shown every item's index and display text. Not its note, not its
 * tokens, not the daily note, and not a line the parser did not understand.
 * The pane's sentence says exactly that, and the tick beside the sentence is
 * the consent.
 *
 * Pure. It never sees the DOM, so a label cannot be markup by the time a view
 * has it - the view sets `textContent` and the text is a string.
 */

/** @typedef {import('./model.js').Document} Document */
/** @typedef {{index: number, text: string}} Line */
/** @typedef {{plugin: string, label: string, href: string}} Badge */

/** A marker, not a sentence. Sixteen characters is `#4412` and room to spare. */
const LONGEST = 16

/**
 * Every line a plugin is shown, in page order.
 *
 * @param {Document|null} doc
 * @returns {Line[]}
 */
export function linesOf(doc) {
  if (doc === null) return []
  /** @type {Line[]} */
  const lines = []
  doc.nodes.forEach((node, index) => {
    if (node.kind !== 'item') return
    lines.push({ index, text: node.text })
  })
  return lines
}

/**
 * What makes an old answer wrong.
 *
 * The lines sent, not the page: a keystroke in the daily note changes the page
 * and not one word of what the plugin was shown, and re-asking on it would put
 * a plugin behind every character typed (spec §1.4).
 *
 * @param {string} date  `YYYY-MM-DD`
 * @param {Line[]} lines
 * @returns {string}
 */
export function badgeKey(date, lines) {
  let hash = 0x811c9dc5
  for (const line of lines) {
    for (const char of `${line.index}\t${line.text}\n`) {
      hash ^= char.codePointAt(0) ?? 0
      // FNV-1a, in the arithmetic JavaScript actually has. Not a security
      // property: two different pages hashing the same would re-use an answer,
      // which costs a wrong marker until the next edit.
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  return `${date}:${lines.length}:${hash.toString(36)}`
}

/**
 * The markers the plugins put on this page's lines.
 *
 * Everything here arrived from somebody else's code, so it is believed one
 * field at a time and anything that does not survive is dropped and counted.
 *
 * @param {{plugin: string, value: unknown}[]} answers
 * @param {Line[]} lines  exactly what was sent, which is what an index may name
 * @returns {{badges: Map<number, Badge[]>, notices: string[]}}
 */
export function readBadges(answers, lines) {
  /** @type {Map<number, Badge[]>} */
  const badges = new Map()
  /** @type {string[]} */
  const notices = []
  const sent = new Set(lines.map((line) => line.index))

  for (const answer of answers) {
    if (!Array.isArray(answer.value)) {
      notices.push(`${answer.plugin} returned something that is not a list`)
      continue
    }

    let dropped = 0
    for (const one of answer.value) {
      const badge = readOne(one, answer.plugin, sent)
      if (badge === null) {
        dropped += 1
        continue
      }
      const on = badges.get(badge.index) ?? []
      // One marker per line per plugin. A plugin "can put a marker after one"
      // line, not a row of them, and a second is how a page fills up.
      if (on.some((already) => already.plugin === answer.plugin)) {
        dropped += 1
        continue
      }
      on.push({ plugin: badge.plugin, label: badge.label, href: badge.href })
      badges.set(badge.index, on)
    }

    // Counted, not listed. One malformed badge is worth saying; forty would be
    // forty lines of notice over a list of three tasks.
    if (dropped > 0) {
      notices.push(`${answer.plugin} sent ${dropped} ${dropped === 1 ? 'marker' : 'markers'} this app could not read`)
    }
  }

  return { badges, notices }
}

/**
 * @param {unknown} raw
 * @param {string} plugin
 * @param {Set<number>} sent
 * @returns {(Badge & {index: number})|null}
 */
function readOne(raw, plugin, sent) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = /** @type {Record<string, unknown>} */ (raw)

  const index = fields['index']
  // A line that was not sent cannot be marked. The lines may have moved while
  // the plugin was thinking, and a marker against the wrong line is worse than
  // no marker (spec §3.5).
  if (typeof index !== 'number' || !sent.has(index)) return null

  const label = flatten(fields['label'])
  if (label === '') return null

  const href = fields['href']
  // A string the app decides what to do with. Whether it may be opened is not
  // this reader's question - that is `core/urls.js` and, on the click, Rust.
  if (typeof href !== 'string' || href === '') return null

  return { index, plugin, label, href }
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
