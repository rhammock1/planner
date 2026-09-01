// @ts-check

/**
 * The edits a view can ask for, as pure functions on a Document.
 *
 * Every one returns a new document and leaves the old one alone. The app then
 * serialises the result and hands it to Rust to write; nothing here touches a
 * file, and nothing here knows that files exist (spec §4.1).
 */

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./model.js').Item} Item */
/** @typedef {import('./model.js').ItemState} ItemState */

/**
 * @param {Document} doc
 * @param {number} index  position in `doc.nodes`
 * @param {ItemState} state
 * @returns {Document}
 */
export function setItemState(doc, index, state) {
  const node = doc.nodes[index]
  // Refusing beats writing to the wrong line: an index that no longer points
  // at an item means the caller is working from a stale read (spec §8).
  if (node === undefined || node.kind !== 'item') {
    throw new Error(`line ${index} is not an item`)
  }

  const nodes = [...doc.nodes]
  nodes[index] = { ...node, state }
  return { ...doc, nodes }
}

/**
 * Replaces an item's display text, leaving its state and every token alone.
 *
 * The text here is the text without tokens - what the page shows. A `@10:30`
 * typed into it survives as text, is written to the file as written, and is
 * read back as a time on the next pass, exactly as though it had been typed
 * in an editor. There is one parser and it runs in one place.
 *
 * @param {Document} doc
 * @param {number} index  position in `doc.nodes`
 * @param {string} text
 * @returns {Document}
 */
export function setItemText(doc, index, text) {
  const node = doc.nodes[index]
  if (node === undefined || node.kind !== 'item') {
    throw new Error(`line ${index} is not an item`)
  }

  const nodes = [...doc.nodes]
  nodes[index] = { ...node, text: text.trim() }
  return { ...doc, nodes }
}

/**
 * Replaces an item's note - the indented line, or lines, under it.
 *
 * `null` removes it. So does a note that is only whitespace: a `>` line with
 * nothing after it is a line the user cannot see and cannot click on, and
 * leaving one behind means the next save keeps carrying it.
 *
 * @param {Document} doc
 * @param {number} index  position in `doc.nodes`
 * @param {string|null} note
 * @returns {Document}
 */
export function setItemNote(doc, index, note) {
  const node = doc.nodes[index]
  if (node === undefined || node.kind !== 'item') {
    throw new Error(`line ${index} is not an item`)
  }

  const trimmed = note === null ? null : note.trim()
  const nodes = [...doc.nodes]
  nodes[index] = { ...node, note: trimmed === '' ? null : trimmed }
  return { ...doc, nodes }
}

/**
 * Adds an item to the end of the page's content.
 *
 * End of the content, not end of the file: a page that ends in a blank line
 * before its `---` keeps that blank line where it is, instead of collecting a
 * gap in the middle every time something is written down. A page with no
 * content yet keeps the blank line under its header, which is where the
 * canonical layout puts it.
 *
 * The daily note is not part of `nodes` - it is everything after the final
 * rule - so an appended item lands above it with no special handling.
 *
 * @param {Document} doc
 * @param {Item} item
 * @returns {Document}
 */
export function appendItem(doc, item) {
  let at = doc.nodes.length
  while (at > 0 && isBlank(doc.nodes[at - 1])) at -= 1
  if (at === 0) at = doc.nodes.length

  const nodes = [...doc.nodes]
  nodes.splice(at, 0, item)
  return { ...doc, nodes }
}

/**
 * Takes a line off the page entirely.
 *
 * Not the same as dropping it. `[-]` is a decision the page keeps a record of
 * - you considered it and said no. This is for a line that should never have
 * been written: a typo, a duplicate, somebody else's example. Nothing is left
 * behind, because there is nothing worth remembering.
 *
 * @param {Document} doc
 * @param {number} index  position in `doc.nodes`
 * @returns {Document}
 */
export function removeItem(doc, index) {
  const node = doc.nodes[index]
  if (node === undefined || node.kind !== 'item') {
    throw new Error(`line ${index} is not an item`)
  }

  const nodes = [...doc.nodes]
  nodes.splice(index, 1)
  return { ...doc, nodes }
}

/**
 * Whether a line would be empty without its text - nothing but the words.
 *
 * An item carrying a time, a deadline, a lead or a note is a commitment with
 * more on it than the sentence, and emptying the sentence is far more likely
 * to be a slip than an instruction to throw the rest away.
 *
 * @param {import('./model.js').Item} item
 * @returns {boolean}
 */
export function carriesNothingElse(item) {
  return item.time === null && item.due === null && item.lead === null
    && item.note === null && item.movedTo === null
}

/**
 * @param {import('./model.js').Node|undefined} node
 * @returns {boolean}
 */
function isBlank(node) {
  return node !== undefined && node.kind === 'opaque' && node.raw.trim() === ''
}

/**
 * @param {Document} doc
 * @param {string} note  `''` keeps the rule with nothing after it
 * @returns {Document}
 */
export function setDailyNote(doc, note) {
  return { ...doc, dailyNote: note }
}
