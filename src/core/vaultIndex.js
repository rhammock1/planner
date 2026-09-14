// @ts-check

/**
 * An in-memory index over every page in the vault.
 *
 * The index is a plain Map from page key to Document, rebuilt from disk and
 * replaced one page at a time as the watcher reports changes (spec §4.1).
 * There is no derived state to keep in sync, because a decade of pages is
 * under 2MB of text and walking it is cheaper than maintaining caches.
 *
 * A page key is a `YYYY-MM-DD` date or the literal `someday`. The back page
 * has no date, so a date alone cannot address every page.
 */

import { isValidDate } from './model.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./model.js').Item} Item */

/** @typedef {string} PageKey a `YYYY-MM-DD` date, or SOMEDAY */
/** @typedef {Map<PageKey, Document>} VaultIndex */

/**
 * An item plus the address it was found at. Identity is
 * `(page, index-within-file)` per spec §3.5, recomputed on every load, and
 * `index` is the position in `doc.nodes` - the address a write needs in order
 * to replace exactly that line.
 *
 * @typedef {object} IndexedItem
 * @property {PageKey} page
 * @property {number} index
 * @property {Item} item
 */

/** The back page's key. */
export const SOMEDAY = 'someday'

const DAY_PATH = /(?:^|\/)(\d{4})\/(\d{2})\/(\d{4}-\d{2}-\d{2})\.md$/
const SOMEDAY_PATH = /(?:^|\/)someday\.md$/

/**
 * @param {Iterable<{page: PageKey, doc: Document}>} pages
 * @returns {VaultIndex}
 */
export function buildIndex(pages) {
  /** @type {VaultIndex} */
  const index = new Map()
  for (const { page, doc } of pages) index.set(page, doc)
  return index
}

/**
 * Null rather than undefined, because a day with nothing on it has no file
 * (spec §3.1) and that is an ordinary state, not a lookup failure.
 *
 * @param {VaultIndex} index
 * @param {PageKey} page
 * @returns {Document|null}
 */
export function getPage(index, page) {
  return index.get(page) ?? null
}

/**
 * Days ascending, with the back page last. The back page has no date, so it
 * can only sit at one end; last is where it sits in the footer.
 *
 * @param {VaultIndex} index
 * @returns {PageKey[]}
 */
export function pageKeys(index) {
  const days = [...index.keys()].filter((page) => page !== SOMEDAY).sort()
  return index.has(SOMEDAY) ? [...days, SOMEDAY] : days
}

/**
 * Every item in the vault, in page order and then file order.
 *
 * @param {VaultIndex} index
 * @returns {IndexedItem[]}
 */
export function items(index) {
  /** @type {IndexedItem[]} */
  const found = []
  for (const page of pageKeys(index)) {
    const doc = index.get(page)
    if (doc === undefined) continue
    doc.nodes.forEach((node, at) => {
      if (node.kind === 'item') found.push({ page, index: at, item: node })
    })
  }
  return found
}

/**
 * Every `^abc123` in the vault, each pointing at the line that holds it.
 *
 * Built on demand from one walk rather than kept in sync, which is this
 * module's standing bargain: a decade of pages is under 2MB of text already in
 * memory. The Map is what keeps a stamp off a full scan per line - a caller
 * naming fifty lines builds this once and adds to it as it goes (`ids.js`).
 *
 * Latest wins where an id appears twice. `items` walks days ascending with the
 * back page last, so writing every match and keeping the final one resolves to
 * the live line under both readings of "latest": a later day, or a line sent
 * to `someday`. Two lines holding one id is a state `move.js` deliberately
 * writes through and a user creates by duplicating a line, so it is a case to
 * resolve rather than an invariant to trust (spec §2.3).
 *
 * @param {VaultIndex} index
 * @returns {Map<string, IndexedItem>}
 */
export function idIndex(index) {
  /** @type {Map<string, IndexedItem>} */
  const found = new Map()
  for (const entry of items(index)) {
    if (entry.item.id !== null) found.set(entry.item.id, entry)
  }
  return found
}

/**
 * Returns a new index with one page replaced, added, or - for a null document
 * - removed. The old index is left alone so a render in flight keeps seeing
 * the vault it started with.
 *
 * @param {VaultIndex} index
 * @param {PageKey} page
 * @param {Document|null} doc
 * @returns {VaultIndex}
 */
export function withPage(index, page, doc) {
  const next = new Map(index)
  if (doc === null) next.delete(page)
  else next.set(page, doc)
  return next
}

/**
 * The page's path relative to the vault root.
 *
 * @param {PageKey} page
 * @returns {string}
 */
export function pathFor(page) {
  if (page === SOMEDAY) return 'someday.md'
  return `${page.slice(0, 4)}/${page.slice(5, 7)}/${page}.md`
}

/**
 * The page a vault path addresses, or null if the path is not a page.
 *
 * Anything ahead of the page's own folders is ignored, so the watcher's
 * absolute paths need no preparation. A day whose folders disagree with its
 * filename is rejected: that would give one date two homes, and a write would
 * land in whichever the caller happened to compute.
 *
 * @param {string} path
 * @returns {PageKey|null}
 */
export function pageForPath(path) {
  if (SOMEDAY_PATH.test(path)) return SOMEDAY
  const match = path.match(DAY_PATH)
  if (match === null) return null
  const [, year, month, date] = match
  if (date === undefined || !isValidDate(date)) return null
  if (year !== date.slice(0, 4) || month !== date.slice(5, 7)) return null
  return date
}
