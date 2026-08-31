// @ts-check

/**
 * Markdown text -> Document.
 *
 * The parser never rejects a file. Anything it does not recognise becomes an
 * Opaque node and is written back untouched (spec §3.4), so a hand-edited
 * file can contain whatever the user likes without risk.
 */

import { stateFor, createItem, isValidDate, isValidTime } from './model.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./model.js').Node} Node */
/** @typedef {import('./model.js').Item} Item */

const HEADER_DAY = /^# (\d{4}-\d{2}-\d{2})\s*$/
const HEADER_SOMEDAY = /^# Someday\s*$/i
const ITEM = /^- \[([ xX>-])\] ?(.*)$/
const NOTE = /^ {2,}> ?(.*)$/
const RULE = /^---\s*$/

// Each token must be preceded by start-of-line or whitespace and followed by
// whitespace or end-of-line, so `dana@gotab.io` and `5~10` stay prose.
const TIME = /(?:^|\s)@(\d{1,2}):(\d{2})(?=\s|$)/
const DUE = /(?:^|\s)!(\d{4}-\d{2}-\d{2})(?=\s|$)/
const LEAD = /(?:^|\s)~(\d+)d(?=\s|$)/
const MOVED = /(?:^|\s)>(\d{4}-\d{2}-\d{2})(?=\s|$)/

/**
 * @param {string} text
 * @returns {Document}
 */
export function parse(text) {
  const { frontmatter, rest: lines } = takeFrontmatter(splitLines(text))

  // The daily note is everything after the LAST column-0 rule. Choosing the
  // last one keeps the rule deterministic when a file contains more than one.
  let ruleIndex = -1
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (RULE.test(lines[i] ?? '')) { ruleIndex = i; break }
  }

  const body = ruleIndex === -1 ? lines : lines.slice(0, ruleIndex)
  const dailyNote = ruleIndex === -1
    ? null
    : trimBlankEdges(lines.slice(ruleIndex + 1)).join('\n')

  /** @type {'day'|'someday'} */
  let kind = 'someday'
  /** @type {string|null} */
  let date = null
  let start = 0

  // Look past leading blank lines so a stray newline at the top of a file does
  // not demote a day page to the back page. Those blanks are dropped as
  // canonicalisation; only a file whose first non-blank line is a header is
  // promoted, so a genuinely headerless file is untouched.
  let headerAt = 0
  while (headerAt < body.length && (body[headerAt] ?? '').trim() === '') headerAt += 1

  const candidate = body[headerAt]
  if (candidate !== undefined) {
    const day = candidate.match(HEADER_DAY)
    if (day && day[1] !== undefined && isValidDate(day[1])) {
      kind = 'day'
      date = day[1]
      start = headerAt + 1
    } else if (HEADER_SOMEDAY.test(candidate)) {
      kind = 'someday'
      start = headerAt + 1
    }
  }

  /** @type {Node[]} */
  const nodes = []
  // A note only attaches to the item immediately above it, and only while no
  // other line has intervened — so a blank line ends the note.
  /** @type {Item|null} */
  let openItem = null

  for (const line of body.slice(start)) {
    const noteMatch = line.match(NOTE)
    if (noteMatch && openItem !== null) {
      const body = noteMatch[1] ?? ''
      openItem.note = openItem.note === null ? body : `${openItem.note}\n${body}`
      continue
    }

    const node = parseLine(line)
    nodes.push(node)
    openItem = node.kind === 'item' ? node : null
  }

  return { kind, date, frontmatter, nodes, dailyNote }
}

/**
 * Splits a file into lines, tolerating CRLF and a leading BOM.
 *
 * Line endings are normalised to LF on write. A file arriving from Windows
 * tooling would otherwise parse its header and rule (whose patterns end in
 * `\s*$` and swallow the `\r`) while every item line fell through to Opaque,
 * leaving the day looking empty.
 *
 * The trailing empty string from a file that ends in a newline is dropped, or
 * every well-formed file would gain a blank node on each round trip.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * @param {string} line
 * @returns {Node}
 */
function parseLine(line) {
  const match = line.match(ITEM)
  if (match) {
    const state = stateFor(match[1] ?? '')
    if (state !== null) {
      const { text, ...tokens } = extractTokens(match[2] ?? '')
      return createItem(text, { state, ...tokens })
    }
  }
  return { kind: 'opaque', raw: line }
}

/**
 * Pulls inline tokens out of an item's raw text.
 *
 * A token that fails validation is deliberately left in the text: a typo the
 * user can see and fix beats metadata silently invented from it.
 *
 * @param {string} raw
 * @returns {{text: string, time: string|null, due: string|null, lead: number|null, movedTo: string|null}}
 */
function extractTokens(raw) {
  let text = raw
  /** @type {string|null} */ let time = null
  /** @type {string|null} */ let due = null
  /** @type {number|null} */ let lead = null
  /** @type {string|null} */ let movedTo = null

  /**
   * Scans every occurrence and keeps the last one that validates. `accept`
   * validates before assigning, so a rejected match leaves the previous
   * winner in place.
   *
   * @param {RegExp} pattern
   * @param {(match: RegExpMatchArray) => boolean} accept returns false to leave the match in place
   */
  const take = (pattern, accept) => {
    const scan = new RegExp(pattern.source, 'g')
    /** @type {RegExpMatchArray|null} */
    let chosen = null
    for (const match of text.matchAll(scan)) {
      if (accept(match)) chosen = match
    }
    if (chosen === null || chosen.index === undefined) return
    const before = text.slice(0, chosen.index)
    const after = text.slice(chosen.index + chosen[0].length)
    // Rejoin with a single space only when removing the token would weld two
    // words together. A global \s+ collapse here would rewrite tabs, NBSP and
    // U+3000 inside prose the user typed.
    const join = before === '' || after === '' || /\s$/.test(before) || /^\s/.test(after)
      ? ''
      : ' '
    text = `${before}${join}${after}`
  }

  take(TIME, (m) => {
    const hours = Number(m[1])
    const minutes = Number(m[2])
    if (!isValidTime(hours, minutes)) return false
    time = `${String(hours).padStart(2, '0')}:${m[2]}`
    return true
  })

  take(DUE, (m) => {
    if (m[1] === undefined || !isValidDate(m[1])) return false
    due = m[1]
    return true
  })

  take(LEAD, (m) => {
    lead = Number(m[1])
    return true
  })

  take(MOVED, (m) => {
    if (m[1] === undefined || !isValidDate(m[1])) return false
    movedTo = m[1]
    return true
  })

  return { text: text.trim(), time, due, lead, movedTo }
}

/**
 * Drops blank lines from both ends. The canonical layout puts exactly one
 * blank line after the rule (spec §3.2), and serialize re-emits it, so the
 * note itself must not carry it.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function trimBlankEdges(lines) {
  let first = 0
  let last = lines.length
  while (first < last && (lines[first] ?? '').trim() === '') first += 1
  while (last > first && (lines[last - 1] ?? '').trim() === '') last -= 1
  return lines.slice(first, last)
}

/**
 * Splits a leading `---`-delimited block off the front of the file.
 *
 * This runs before anything else so the backward rule scan never sees the
 * block's closing delimiter. Without it, frontmatter's own `---` becomes the
 * last rule in the file, and the entire document is read as one daily note.
 *
 * An opening delimiter with no closing one is NOT frontmatter — that is an
 * ordinary rule, and the file is read the normal way.
 *
 * @param {string[]} lines
 * @returns {{frontmatter: string[]|null, rest: string[]}}
 */
function takeFrontmatter(lines) {
  if (!RULE.test(lines[0] ?? '')) return { frontmatter: null, rest: lines }
  for (let i = 1; i < lines.length; i += 1) {
    if (RULE.test(lines[i] ?? '')) {
      return { frontmatter: lines.slice(1, i), rest: lines.slice(i + 1) }
    }
  }
  return { frontmatter: null, rest: lines }
}
