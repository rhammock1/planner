// @ts-check

/**
 * `theme.toml` -> the CSS custom properties a theme sets (spec §6).
 *
 * The token names are a published contract: `docs/themes.md` versions them,
 * adding one is fine, renaming one is not. A theme that names only some of
 * them still renders, because the rest come from Ledger.
 *
 * Token values are checked before they reach a stylesheet. A theme is a
 * folder the user installed, and everything in it lands inside a CSS rule
 * this module writes - so a value that could close that rule, start another
 * declaration, leave the style element, or reach the network is refused and
 * replaced with the default. Themes never touch the network.
 */

import { parseToml, getPath } from './toml.js'

/** @typedef {import('./toml.js').TomlTable} TomlTable */

/**
 * @typedef {object} Theme
 * @property {string} name
 * @property {string} author
 * @property {'light'|'dark'} appearance  drives macOS window appearance
 * @property {Map<string, string>} tokens
 */

/**
 * The published token list, in the order a stylesheet emits it. Never remove
 * a name from here without a major version.
 *
 * @type {readonly string[]}
 */
export const TOKEN_NAMES = Object.freeze([
  'paper', 'surface', 'edge', 'edge-soft', 'ink', 'dim', 'accent', 'alert',
  'font-head', 'font-body', 'font-meta', 'radius', 'texture',
])

/** @type {[string, string][]} */
const LEDGER_TOKENS = [
  ['paper', '#FBFAF6'],
  ['surface', '#F4F2EA'],
  ['edge', '#D9D6CC'],
  ['edge-soft', '#E7E4DA'],
  ['ink', '#23262A'],
  ['dim', '#8B8981'],
  ['accent', '#17605B'],
  ['alert', '#A8452C'],
  ['font-head', 'Newsreader, Georgia, serif'],
  ['font-body', 'Public Sans, system-ui, sans-serif'],
  ['font-meta', 'IBM Plex Mono, monospace'],
  ['radius', '10px'],
  ['texture', 'radial-gradient(#E2DFD4 1px, transparent 1px) 8px 8px / 14px 14px'],
]

/**
 * The default theme, and the fallback for anything a theme leaves out or
 * gets wrong. It is built in as well as bundled in `themes/ledger/`, so the
 * app has a complete set of tokens before it has read any file at all.
 *
 * @type {Theme}
 */
export const LEDGER = Object.freeze({
  name: 'Ledger',
  author: 'Robert Hammock',
  /** @type {'light'} */
  appearance: 'light',
  tokens: new Map(LEDGER_TOKENS),
})

// A value is refused whole rather than escaped, so that what the theme author
// wrote is either used as written or reported - never quietly rewritten into
// something they did not ask for.
const FORBIDDEN = [
  { pattern: /[{}]/, why: 'a brace would end the rule this value sits in' },
  { pattern: /;/, why: 'a semicolon would start another declaration' },
  { pattern: /<|>/, why: 'angle brackets would leave the style element' },
  { pattern: /@import/i, why: 'an import would reach outside the theme' },
  { pattern: /url\(\s*['"]?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i, why: 'a url may only be a file beside the stylesheet, never another site' },
  { pattern: /\\/, why: 'a backslash could hide a scheme from the rule above it' },
  { pattern: /\b(?:image-set|cross-fade)\s*\(/i, why: 'this would fetch something, and only a file beside the stylesheet may be fetched' },
  { pattern: /\/\*/, why: 'a comment would swallow the rest of the style element' },
]

/**
 * Whether a value's own brackets and quotes close by the end of it.
 *
 * Not expressible as a pattern, and the rules above do not cover it: `rgb(`
 * holds no forbidden character, but CSS consumes an unclosed function to the
 * end of the stylesheet. One value carrying it therefore takes every
 * declaration after it - and, in a plugin's rule, that means another plugin's
 * tokens, silently, since the app believes it wrote them. An unclosed quote
 * does the same to the declaration that follows it.
 *
 * No escape handling, because a backslash is already refused above.
 *
 * @param {string} value
 * @returns {boolean}
 */
function unbalanced(value) {
  let depth = 0
  let quote = ''
  for (const character of value) {
    if (quote !== '') {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      // A stray `)` closes the rule's own function, not one this value opened.
      if (depth < 0) return true
    }
  }
  return depth !== 0 || quote !== ''
}

/**
 * Why a value is refused, or nothing.
 *
 * Exported because a plugin's tokens go through exactly the same checks a
 * theme's do (spec §3.3) - and a second copy of this list is a second thing
 * to forget to add a rule to.
 *
 * @param {string} value
 * @returns {{why: string}|null}
 */
export function forbidden(value) {
  const rule = FORBIDDEN.find((one) => one.pattern.test(value))
  if (rule !== undefined) return { why: rule.why }
  if (unbalanced(value)) {
    return { why: 'its brackets or quotes do not close, which would swallow what follows' }
  }
  return null
}

/**
 * A fresh copy, so a view that reaches into `theme.tokens` cannot leave the
 * built-in default changed for everything read afterwards.
 *
 * @returns {Theme}
 */
function ledgerTheme() {
  return {
    name: LEDGER.name,
    author: LEDGER.author,
    appearance: LEDGER.appearance,
    tokens: new Map(LEDGER_TOKENS),
  }
}

/**
 * @param {string} text the contents of theme.toml
 * @returns {{theme: Theme, notices: string[]}}
 */
export function readTheme(text) {
  /** @type {string[]} */
  const notices = []

  /** @type {TomlTable} */
  let table = {}
  try {
    table = parseToml(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { theme: ledgerTheme(), notices: [`theme.toml could not be read (${detail}); using ${LEDGER.name}`] }
  }

  return {
    theme: {
      name: readString(table, 'name', LEDGER.name, notices),
      author: readString(table, 'author', LEDGER.author, notices),
      appearance: readAppearance(table, notices),
      tokens: readTokens(table, notices),
    },
    notices,
  }
}

/**
 * The theme as a stylesheet: one rule setting every token as a custom
 * property on `:root`, ahead of the app's own CSS.
 *
 * @param {Theme} theme
 * @returns {string}
 */
export function themeCss(theme) {
  const lines = [':root {', `  color-scheme: ${theme.appearance};`]
  for (const [name, value] of theme.tokens) lines.push(`  --${name}: ${value};`)
  lines.push('}', '')
  return lines.join('\n')
}

/**
 * Starts from Ledger's tokens so a partial theme is still a complete one,
 * then lays the theme's own values over the top. A theme may define tokens
 * beyond the contract for its own `theme.css` to use.
 *
 * @param {TomlTable} table
 * @param {string[]} notices
 * @returns {Map<string, string>}
 */
function readTokens(table, notices) {
  const tokens = new Map(LEDGER_TOKENS)

  const section = table['tokens']
  if (section === undefined) return tokens
  if (typeof section !== 'object' || Array.isArray(section)) {
    notices.push('theme.toml: tokens is not a table; using the default tokens')
    return tokens
  }

  for (const [name, value] of Object.entries(section)) {
    if (typeof value !== 'string') {
      notices.push(`theme.toml: token ${name} is not a string; using the default`)
      continue
    }
    const refused = forbidden(value)
    if (refused !== null) {
      notices.push(`theme.toml: token ${name} was refused - ${refused.why}`)
      continue
    }
    tokens.set(name, value)
  }
  return tokens
}

/**
 * @param {TomlTable} table
 * @param {string} key
 * @param {string} fallback
 * @param {string[]} notices
 * @returns {string}
 */
function readString(table, key, fallback, notices) {
  const raw = getPath(table, [key])
  if (raw === undefined) return fallback
  if (typeof raw !== 'string') {
    notices.push(`theme.toml: ${key} is not a string; using ${JSON.stringify(fallback)}`)
    return fallback
  }
  return raw
}

/**
 * @param {TomlTable} table
 * @param {string[]} notices
 * @returns {'light'|'dark'}
 */
function readAppearance(table, notices) {
  const raw = getPath(table, ['appearance'])
  if (raw === undefined) return LEDGER.appearance
  if (raw === 'light' || raw === 'dark') return raw
  notices.push(`theme.toml: appearance must be "light" or "dark"; using "${LEDGER.appearance}"`)
  return LEDGER.appearance
}
