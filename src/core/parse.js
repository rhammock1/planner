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
  const lines = splitLines(text)

  /** @type {'day'|'someday'} */
  let kind = 'someday'
  /** @type {string|null} */
  let date = null
  let start = 0

  const first = lines[0]
  if (first !== undefined) {
    const day = first.match(HEADER_DAY)
    if (day && day[1] !== undefined && isValidDate(day[1])) {
      kind = 'day'
      date = day[1]
      start = 1
    } else if (HEADER_SOMEDAY.test(first)) {
      kind = 'someday'
      start = 1
    }
  }

  /** @type {Node[]} */
  const nodes = []
  // A note only attaches to the item immediately above it, and only while no
  // other line has intervened — so a blank line ends the note.
  /** @type {Item|null} */
  let openItem = null

  for (const line of lines.slice(start)) {
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

  return { kind, date, nodes, dailyNote: '' }
}

/**
 * Splits on newlines and drops the single trailing empty string produced by a
 * file that ends with a newline — otherwise every well-formed file would gain
 * a spurious blank node on each round trip.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  const lines = text.split('\n')
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
    text = `${text.slice(0, chosen.index)} ${text.slice(chosen.index + chosen[0].length)}`
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

  return { text: text.replace(/\s+/g, ' ').trim(), time, due, lead, movedTo }
}
