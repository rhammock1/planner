// @ts-check

/**
 * Document -> canonical Markdown.
 *
 * Canonical means: tokens in the order @time !due ~lead >moved, notes indented
 * exactly two spaces, no trailing whitespace, times zero-padded (spec §3.4).
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

  if (doc.dailyNote !== '') {
    lines.push('---', '', doc.dailyNote)
  }

  return `${lines.join('\n')}\n`
}

/**
 * @param {Item} item
 * @returns {string}
 */
function serializeItem(item) {
  const parts = [`- [${markFor(item.state)}]`]
  if (item.text !== '') parts.push(item.text)
  if (item.time !== null) parts.push(`@${item.time}`)
  if (item.due !== null) parts.push(`!${item.due}`)
  if (item.lead !== null) parts.push(`~${item.lead}d`)
  if (item.movedTo !== null) parts.push(`>${item.movedTo}`)
  return parts.join(' ')
}
