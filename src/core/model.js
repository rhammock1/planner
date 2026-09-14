// @ts-check

/**
 * The document model for a planner vault file.
 *
 * Everything here is data and pure predicates. Parsing lives in parse.js and
 * serialising lives in serialize.js, so this module can be imported by both
 * without a cycle.
 */

/** @typedef {'open'|'done'|'migrated'|'dropped'} ItemState */

/**
 * A line the parser understands: a task, optionally carrying metadata.
 * `text` is the display text with all inline tokens stripped out.
 *
 * @typedef {object} Item
 * @property {'item'} kind
 * @property {ItemState} state
 * @property {string} text
 * @property {string|null} time     `HH:MM`, 24-hour, zero-padded
 * @property {string|null} due      `YYYY-MM-DD`
 * @property {number|null} lead     days before `due` that this enters the horizon
 * @property {string|null} movedTo  `YYYY-MM-DD`, set when the item was carried forward
 * @property {string|null} note     may contain newlines; one `  > ` line each
 * @property {string|null} id       `^abc123`, stamped only when something outside
 *   the file needs to name this line (see ids.js)
 */

/**
 * Any line the parser does not understand, including blank lines. Preserved
 * byte-for-byte on write. This is what makes the round-trip guarantee (spec
 * §3.4) possible: unknown content survives untouched.
 *
 * @typedef {object} Opaque
 * @property {'opaque'} kind
 * @property {string} raw
 */

/** @typedef {Item|Opaque} Node */

/**
 * @typedef {object} Document
 * @property {'day'|'someday'} kind
 * @property {string|null} date  `YYYY-MM-DD` for a day file, null for the back page
 * @property {string[]|null} frontmatter  raw lines between a leading pair of `---`
 *   delimiters, exclusive of them; null when the file has no such block
 * @property {Node[]} nodes
 * @property {string|null} dailyNote  free text after the final `---`; `''` when
 *   the rule is present but empty; null when the file has no rule at all
 */

/** @type {readonly ItemState[]} */
export const ITEM_STATES = /** @type {const} */ ([
  'open', 'done', 'migrated', 'dropped',
])

/** @type {Record<ItemState, string>} */
const MARKS = {
  open: ' ',
  done: 'x',
  migrated: '>',
  dropped: '-',
}

/**
 * @param {ItemState} state
 * @returns {string}
 */
export function markFor(state) {
  return MARKS[state]
}

/**
 * Accepts `X` as well as `x` so hand-edited files aren't rejected over case.
 *
 * @param {string} mark
 * @returns {ItemState|null}
 */
export function stateFor(mark) {
  if (mark === 'X') return 'done'
  for (const state of ITEM_STATES) {
    if (MARKS[state] === mark) return state
  }
  return null
}

/**
 * True only for a real calendar date in `YYYY-MM-DD` form. Round-tripping
 * through Date catches 2026-02-30 and friends, which a regex alone would not.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const date = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  return date.toISOString().slice(0, 10) === s
}

/**
 * @param {number} hours
 * @param {number} minutes
 * @returns {boolean}
 */
export function isValidTime(hours, minutes) {
  return Number.isInteger(hours) && Number.isInteger(minutes)
    && hours >= 0 && hours <= 23
    && minutes >= 0 && minutes <= 59
}

/**
 * @param {string} text
 * @param {Partial<Item>} [overrides]
 * @returns {Item}
 */
export function createItem(text, overrides = {}) {
  return {
    kind: 'item',
    state: 'open',
    text,
    time: null,
    due: null,
    lead: null,
    movedTo: null,
    note: null,
    id: null,
    ...overrides,
  }
}

/**
 * A fresh day starts with one blank line under the header, matching the
 * canonical layout in spec §3.2. The blank is an Opaque node so that
 * serialising a brand-new document and serialising a parsed one take the
 * same path.
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {Document}
 */
export function createDayDocument(date) {
  return { kind: 'day', date, frontmatter: null, nodes: [{ kind: 'opaque', raw: '' }], dailyNote: null }
}

/** @returns {Document} */
export function createSomedayDocument() {
  return { kind: 'someday', date: null, frontmatter: null, nodes: [{ kind: 'opaque', raw: '' }], dailyNote: null }
}
