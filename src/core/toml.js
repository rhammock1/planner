// @ts-check

/**
 * The small slice of TOML this app's files actually use, read without a
 * dependency.
 *
 * Supported: bare keys, basic strings, integers, floats, booleans, arrays of
 * strings, `[table]` and `[dotted.table]` headers, comments. That is the
 * whole of `config.toml` (spec §3.6) and `theme.toml` (spec §6). Anything
 * else - multi-line strings, inline tables, dates - is refused by line
 * number rather than half-understood.
 *
 * Reading only. Writes live in tomlEdit.js, which edits the text in place so
 * that unknown keys, comments and a hand-aligned column of `=` survive.
 */

/** @typedef {string|number|boolean|string[]} TomlValue */
/** @typedef {{[key: string]: TomlValue|TomlTable}} TomlTable */

/**
 * The lexical pieces below are exported for tomlEdit.js, which has to find
 * the same keys and value spans in order to replace one in place. Nothing
 * else should reach for them.
 */
export const KEY = /^([A-Za-z0-9_-]+)\s*=\s*/
export const HEADER = /^\[([A-Za-z0-9_.-]+)\]\s*$/

/**
 * Whether a name may be written back as a bare key.
 *
 * TOML's own rule, and this app's for the same reason: `tomlEdit` writes a key
 * exactly as it is given, so a name with a dot in it would be read back as a
 * path into a table nobody meant, and one with a bracket and a newline in it
 * would open somebody else's (spec §0.2, §1.1).
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isBareKey(name) {
  return /^[A-Za-z0-9_-]+$/.test(name)
}

/**
 * @param {string} text
 * @returns {TomlTable}
 * @throws {SyntaxError} naming the line, so a malformed file can say where
 */
export function parseToml(text) {
  /** @type {TomlTable} */
  const root = {}
  let table = root
  /** @type {Set<string>} */
  const seen = new Set()
  let prefix = ''

  splitLines(text).forEach((line, at) => {
    /** @param {string} message @returns {never} */
    const fail = (message) => { throw new SyntaxError(`line ${at + 1}: ${message}`) }

    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return

    if (trimmed.startsWith('[')) {
      const header = trimmed.match(HEADER)
      if (header === null || header[1] === undefined) fail(`not a table header: ${trimmed}`)
      prefix = `${header[1]}.`
      table = descend(root, header[1].split('.'))
      return
    }

    const key = trimmed.match(KEY)
    if (key === null || key[1] === undefined) fail(`not a key: ${trimmed}`)

    const scanned = scanValue(trimmed, key[0].length)
    if (scanned === null) fail(`not a value: ${trimmed.slice(key[0].length)}`)
    const rest = trimmed.slice(scanned.end).trim()
    if (rest !== '' && !rest.startsWith('#')) fail(`unexpected text after the value: ${rest}`)

    // Duplicates are refused rather than resolved: two values for `vault`
    // would mean guessing which folder the user meant.
    if (seen.has(prefix + key[1])) fail(`${key[1]} is set twice`)
    seen.add(prefix + key[1])
    setKey(table, key[1], scanned.value)
  })

  return root
}

/**
 * Reads a nested value, returning undefined for any missing step.
 *
 * @param {TomlTable} table
 * @param {string[]} path
 * @returns {TomlValue|undefined}
 */
export function getPath(table, path) {
  /** @type {TomlValue|TomlTable|undefined} */
  let node = table
  for (const key of path) {
    if (node === undefined || typeof node !== 'object' || Array.isArray(node)) return undefined
    node = Object.hasOwn(node, key) ? node[key] : undefined
  }
  if (node === undefined || (typeof node === 'object' && !Array.isArray(node))) return undefined
  return node
}

/**
 * Reads one value starting at `start`, returning where it ends so a caller
 * can replace exactly that span. Null when the text is not a value this
 * subset understands.
 *
 * @param {string} line
 * @param {number} start
 * @returns {{value: TomlValue, end: number}|null}
 */
export function scanValue(line, start) {
  const char = line[start]
  if (char === '"') return scanString(line, start)
  if (char === '[') return scanArray(line, start)

  const raw = line.slice(start).split('#')[0]?.trimEnd() ?? ''
  if (raw === '') return null
  const end = start + raw.length
  if (raw === 'true') return { value: true, end }
  if (raw === 'false') return { value: false, end }
  if (/^-?\d+$/.test(raw) || /^-?\d+\.\d+$/.test(raw)) return { value: Number(raw), end }
  return null
}

/**
 * @param {string} line
 * @param {number} start index of the opening quote
 * @returns {{value: string, end: number}|null}
 */
function scanString(line, start) {
  let value = ''
  for (let at = start + 1; at < line.length; at += 1) {
    const char = line[at]
    if (char === '\\') {
      const escape = line[at + 1]
      value += escape === 'n' ? '\n' : escape === 't' ? '\t' : escape ?? ''
      at += 1
      continue
    }
    if (char === '"') return { value, end: at + 1 }
    value += char
  }
  return null
}

/**
 * @param {string} line
 * @param {number} start index of the opening bracket
 * @returns {{value: string[], end: number}|null}
 */
function scanArray(line, start) {
  /** @type {string[]} */
  const value = []
  let at = start + 1
  while (at < line.length) {
    while (line[at] === ' ' || line[at] === ',') at += 1
    if (line[at] === ']') return { value, end: at + 1 }
    const element = scanString(line, at)
    if (element === null) return null
    value.push(element.value)
    at = element.end
  }
  return null
}

/**
 * Creates the nested tables for a header path and returns the innermost.
 *
 * @param {TomlTable} root
 * @param {string[]} path
 * @returns {TomlTable}
 */
function descend(root, path) {
  let table = root
  for (const key of path) {
    // Own properties only. Reading `table['__proto__']` returns the prototype
    // itself, and the next key would then be written onto Object.prototype -
    // from a file the app was handed.
    const next = Object.hasOwn(table, key) ? table[key] : undefined
    if (next === undefined || typeof next !== 'object' || Array.isArray(next)) {
      /** @type {TomlTable} */
      const created = {}
      setKey(table, key, created)
      table = created
      continue
    }
    table = next
  }
  return table
}

/**
 * Assignment by hand, because plain `table[key] = value` treats a key named
 * `__proto__` as the prototype setter: the key vanishes from the parsed table
 * and the file's own contents are silently lost. A plugin folder can be named
 * anything, so a key can be too.
 *
 * @param {TomlTable} table
 * @param {string} key
 * @param {TomlValue|TomlTable} value
 * @returns {void}
 */
function setKey(table, key, value) {
  Object.defineProperty(table, key, {
    value, writable: true, enumerable: true, configurable: true,
  })
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
