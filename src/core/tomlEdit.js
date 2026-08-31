// @ts-check

/**
 * Writing to a TOML file without rewriting it.
 *
 * Regenerating the file from parsed data would be simpler and would quietly
 * throw away every comment, every hand-aligned column, and every key this app
 * does not know about. Both `config.toml` (spec §3.6) and `theme.toml` are
 * the user's files first, so a write reaches in and changes one span of one
 * line, leaving the rest byte for byte as it was.
 */

import { KEY, HEADER, scanValue, splitLines } from './toml.js'

/** @typedef {import('./toml.js').TomlValue} TomlValue */
/** @typedef {{path: string[], value: TomlValue}} TomlChange */

/**
 * Applies changes to the text of a TOML file, touching only the lines that
 * carry the affected keys.
 *
 * An existing key keeps its position, its padding, and any comment after its
 * value. A new key is appended to the end of its table, and a table that does
 * not exist yet is appended to the file.
 *
 * @param {string} text
 * @param {TomlChange[]} changes
 * @returns {string}
 */
export function updateToml(text, changes) {
  if (changes.length === 0) return text

  let lines = splitLines(text)
  for (const change of changes) {
    const key = change.path[change.path.length - 1]
    const table = change.path.slice(0, -1).join('.')
    if (key === undefined) continue
    lines = writeKey(lines, table, key, formatValue(change.value))
  }

  const joined = lines.join('\n')
  return joined.endsWith('\n') ? joined : `${joined}\n`
}

/**
 * @param {string[]} lines
 * @param {string} table dotted table name, `''` for the root table
 * @param {string} key
 * @param {string} formatted the value as it should appear in the file
 * @returns {string[]}
 */
function writeKey(lines, table, key, formatted) {
  const next = [...lines]
  let current = ''
  let lastInTable = -1
  let tableSeen = table === ''

  for (let at = 0; at < next.length; at += 1) {
    const trimmed = (next[at] ?? '').trim()
    if (trimmed.startsWith('#')) continue

    const header = trimmed.match(HEADER)
    if (header !== null && header[1] !== undefined) {
      current = header[1]
      if (current === table) { tableSeen = true; lastInTable = at }
      continue
    }
    if (current !== table) continue

    const found = trimmed.match(KEY)
    if (found === null) continue
    lastInTable = at

    if (found[1] === key) {
      const line = next[at] ?? ''
      const start = valueStartOf(line)
      const scanned = scanValue(line, start)
      if (scanned === null) continue
      // Only the value's own span is replaced, so the padding before it and
      // any comment after it stay exactly as the user left them.
      next[at] = line.slice(0, start) + formatted + line.slice(scanned.end)
      return next
    }
  }

  const line = `${key} = ${formatted}`
  if (!tableSeen) {
    if (next.length > 0 && (next[next.length - 1] ?? '').trim() !== '') next.push('')
    next.push(`[${table}]`, line)
    return next
  }
  // A root key must land above the first table header, or it silently becomes
  // a key of that table instead.
  next.splice(lastInTable + 1, 0, line)
  return next
}

/**
 * Where the value begins on a `key = value` line: past the separator and any
 * alignment padding after it.
 *
 * @param {string} line
 * @returns {number}
 */
function valueStartOf(line) {
  const after = line.indexOf('=') + 1
  return after + (line.slice(after).length - line.slice(after).trimStart().length)
}

/**
 * @param {TomlValue} value
 * @returns {string}
 */
function formatValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(quote).join(', ')}]`
  return quote(value)
}

/**
 * @param {string} value
 * @returns {string}
 */
function quote(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}
