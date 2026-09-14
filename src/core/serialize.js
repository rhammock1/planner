// @ts-check

/**
 * Document -> canonical Markdown.
 *
 * Canonical means: tokens in the order @time !due ~lead >moved ^id, notes indented
 * exactly two spaces, no trailing whitespace on item lines, times zero-padded
 * (spec §3.4).
 * Opaque nodes are exempt and written back exactly as they were read.
 */

import { markFor } from './model.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./model.js').Item} Item */

/**
 * @param {Document} doc
 * @returns {string}
 */
export function serialize(doc) {
  /** @type {string[]} */
  const lines = []

  if (doc.frontmatter !== null) {
    lines.push('---', ...doc.frontmatter, '---')
  }

  lines.push(doc.kind === 'day' ? `# ${doc.date}` : '# Someday')

  for (const node of doc.nodes) {
    if (node.kind === 'opaque') {
      lines.push(node.raw)
      continue
    }
    lines.push(serializeItem(node))
    if (node.note !== null) {
      for (const noteLine of node.note.split('\n')) {
        lines.push(noteLine === '' ? '  >' : `  > ${noteLine}`)
      }
    }
  }

  // The rule is written whenever the source had one. Keying this off a
  // non-empty note is what deleted a bare trailing `---` on every save.
  if (doc.dailyNote !== null) {
    lines.push('---')
    if (doc.dailyNote !== '') lines.push('', doc.dailyNote)
  }

  return `${lines.join('\n')}\n`
}

/**
 * One item as the line it is written as, tokens and all.
 *
 * Exported because search matches what is in the file rather than what is on
 * the page: `!2026-09-04` is what you typed, so it is what you can look for
 * (spec §5.7).
 *
 * @param {Item} item
 * @returns {string}
 */
export function serializeItem(item) {
  const parts = [`- [${markFor(item.state)}]`]
  if (item.text !== '') parts.push(item.text)
  if (item.time !== null) parts.push(`@${item.time}`)
  if (item.due !== null) parts.push(`!${item.due}`)
  if (item.lead !== null) parts.push(`~${item.lead}d`)
  if (item.movedTo !== null) parts.push(`>${item.movedTo}`)
  // Last, always. The id is the app's bookkeeping rather than something the
  // user wrote, and the end of the line is where it is least in the way of
  // the sentence when the file is read by hand.
  if (item.id !== null) parts.push(`^${item.id}`)
  return parts.join(' ')
}
