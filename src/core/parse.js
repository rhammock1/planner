// @ts-check

/**
 * Markdown text -> Document.
 *
 * The parser never rejects a file. Anything it does not recognise becomes an
 * Opaque node and is written back untouched (spec §3.4), so a hand-edited
 * file can contain whatever the user likes without risk.
 */

import { stateFor, createItem, isValidDate } from './model.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./model.js').Node} Node */
/** @typedef {import('./model.js').Item} Item */

const HEADER_DAY = /^# (\d{4}-\d{2}-\d{2})\s*$/
const HEADER_SOMEDAY = /^# Someday\s*$/i
const ITEM = /^- \[([ xX>-])\] ?(.*)$/

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
  for (const line of lines.slice(start)) {
    nodes.push(parseLine(line))
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
      return createItem((match[2] ?? '').trimEnd(), { state })
    }
  }
  return { kind: 'opaque', raw: line }
}
