// @ts-check

/**
 * The `^abc123` token: a line's name, for when something outside the file
 * needs to point at it (spec §2.3).
 *
 * Six lowercase alphanumerics after a caret, written last on the line. It is
 * the app's bookkeeping rather than the user's content, which is the reason
 * for every rule here:
 *
 * - **It is stamped lazily.** Nothing mints one because a line was read. A
 *   line gets a name at the moment something needs to refer to it - a line
 *   becoming a card on a board - and at no other moment. A vault nobody has
 *   pointed at from anywhere holds no ids at all, and drawing a day never
 *   writes a byte.
 * - **It moves, it does not copy.** When a line changes days the id travels
 *   with it and comes off the `[>]` line left behind (`carry.js`, `move.js`),
 *   so the common case has exactly one holder.
 * - **And the lookup still copes with two.** `move.js` deliberately writes
 *   through a moment where both pages hold the line, and a user who yanks and
 *   puts a line in any editor copies its id along with it. So `lineWithId`
 *   resolves to the latest page rather than assuming uniqueness, and reads
 *   `migrated` as *moved*, not as *done*.
 */

import { idIndex } from './vaultIndex.js'

/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */
/** @typedef {import('./vaultIndex.js').PageKey} PageKey */
/** @typedef {import('./vaultIndex.js').IndexedItem} IndexedItem */
/** @typedef {import('./model.js').Document} Document */

/** Lowercase only, so a hand-typed `^ABC123` is prose rather than a near-miss. */
export const ID = /^[a-z0-9]{6}$/

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const LENGTH = 6

/**
 * How many times `mintId` will draw before giving up.
 *
 * With 36^6 names there are two billion of them, so a vault would have to hold
 * millions of ids before a single collision is likely and this bound is
 * unreachable by chance. It exists so that a broken `random` - one that
 * returns a constant - fails saying so instead of hanging the app.
 */
const TRIES = 100

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidId(value) {
  return typeof value === 'string' && ID.test(value)
}

/**
 * A name nothing in the vault is using.
 *
 * `taken` is anything that answers `has` - the Map from `idIndex` and a plain
 * Set both do - so a caller stamping several lines builds the index once and
 * adds to it as it goes, rather than walking the vault per line.
 *
 * @param {{has(id: string): boolean}} taken
 * @param {() => number} [random]
 * @returns {string}
 */
export function mintId(taken, random = Math.random) {
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    let id = ''
    for (let at = 0; at < LENGTH; at += 1) {
      id += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length]
    }
    if (!taken.has(id)) return id
  }
  throw new Error(`could not find an unused id in ${TRIES} tries`)
}

/**
 * The line one id names, or null when the vault has none.
 *
 * Latest page wins. `items` walks days ascending with the back page last
 * (`vaultIndex.js::pageKeys`), so the last match in that walk is the live line
 * under both readings of "latest": a day that came after, or a line sent to
 * `someday`, which is where it went when it left the day it was on.
 *
 * A `migrated` line can be the answer. It means the line travelled, and the
 * caller wants to know that - reading it as *done* archives everything the
 * user is still carrying.
 *
 * @param {VaultIndex} index
 * @param {string} id
 * @returns {IndexedItem|null}
 */
export function lineWithId(index, id) {
  return idIndex(index).get(id) ?? null
}

/**
 * Names for a list of lines, and the pages to write to give them those names.
 *
 * This is the only thing that stamps, and it is called from a gesture that
 * makes lines into something else's cards - never from drawing, never from a
 * question put to a plugin (spec §2.3). `ids[n]` is the name of `places[n]`,
 * whether it was minted here or was already on the line; `writes` holds only
 * the pages that changed, and is empty when every line was already named.
 *
 * A whole list at once rather than one call per line, because the two ways to
 * get that wrong are both invisible. Two lines named from the same vault can
 * draw the same name, since neither can look the other's write up in a vault
 * it has not landed in yet; and two lines on one page produce two writes of
 * that page, each missing the other's name. One pass makes both impossible.
 *
 * The caller writes the pages. Nothing here touches a file, the same as
 * everything else in `core`.
 *
 * @param {VaultIndex} index
 * @param {{page: PageKey, at: number}[]} places  `at` is a position in the page's `doc.nodes`
 * @param {() => number} [random]
 * @returns {{ids: string[], writes: {page: PageKey, doc: Document}[]}}
 */
export function stampAll(index, places, random = Math.random) {
  const taken = idIndex(index)
  /** @type {string[]} */
  const ids = []
  /** @type {Map<PageKey, import('./model.js').Node[]>} */
  const changed = new Map()

  for (const { page, at } of places) {
    const doc = index.get(page)
    // A page already stamped in this pass is read from the copy, so a second
    // line on it sees the first line's name rather than the file's old state.
    const node = (changed.get(page) ?? doc?.nodes ?? [])[at]
    // Refusing beats writing to the wrong line: an index that no longer points
    // at an item means the caller is working from a stale read (spec §8).
    if (doc === undefined || node === undefined || node.kind !== 'item') {
      throw new Error(`${page} line ${at} is not an item`)
    }
    if (node.id !== null) {
      ids.push(node.id)
      continue
    }

    const id = mintId(taken, random)
    taken.set(id, { page, index: at, item: node })
    const nodes = changed.get(page) ?? [...doc.nodes]
    nodes[at] = { ...node, id }
    changed.set(page, nodes)
    ids.push(id)
  }

  /** @type {{page: PageKey, doc: Document}[]} */
  const writes = []
  for (const [page, nodes] of changed) {
    const doc = index.get(page)
    if (doc === undefined) throw new Error(`no page in the vault at ${page}`)
    writes.push({ page, doc: { ...doc, nodes } })
  }
  return { ids, writes }
}

/**
 * The name of one line, and the page to write if it did not have one.
 *
 * `write` is null when the line was already named, which is the ordinary case
 * after the first time. Naming more than one line at once goes through
 * `stampAll` - see the two things it exists to make impossible.
 *
 * @param {VaultIndex} index
 * @param {PageKey} page
 * @param {number} at  position in the page's `doc.nodes`
 * @param {() => number} [random]
 * @returns {{id: string, write: {page: PageKey, doc: Document}|null}}
 */
export function stamp(index, page, at, random = Math.random) {
  const { ids, writes } = stampAll(index, [{ page, at }], random)
  const id = ids[0]
  if (id === undefined) throw new Error(`${page} line ${at} is not an item`)
  return { id, write: writes[0] ?? null }
}
