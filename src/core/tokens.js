// @ts-check

/**
 * What a plugin may do to the theme's colours (spec §3.3).
 *
 * A plugin returns a partial map of tokens and the app puts them in a rule of
 * its own, last in the cascade - so a plugin that moves colour can move it,
 * over a `theme.css` that set the same token on `:root` itself.
 *
 * Which makes this the reader that has to be strict. Everything here arrived
 * from somebody else's code and lands inside a CSS rule this app writes, so
 * every value goes through the same checks a theme's own values get, and two
 * more on top: a plugin may only move what its manifest said it would move,
 * and no two plugins may move the same thing.
 */

import { TOKEN_NAMES, forbidden } from './theme.js'

/**
 * A colour, a font stack, or a sky.
 *
 * 200 was a guess about how long a colour is, and a sky is not a colour:
 * `dusk` answers `texture` with three gradient layers over whatever the theme
 * had there already, which on `composition-book` lands at about 200 exactly.
 * Nothing that defends this value gets weaker with length - the character and
 * bracket checks in `theme.js` are the defence, and the number is only there
 * so that a value which is plainly not one of the three above is refused
 * before it reaches a stylesheet.
 *
 * Exported because it is published in `docs/plugins.md` and a plugin composing
 * a value has to know it - `dusk` gives up a layer rather than be refused
 * whole. A plugin cannot import this, so its own copy is what a test compares
 * against: two numbers that must agree are two numbers that will not.
 */
export const LONGEST = 400

/**
 * The key that makes an old answer wrong: the minute, and the generation.
 *
 * The minute rather than the quarter hour it used to be. Fifteen minutes is
 * when the alarm thread wakes, which is a fact about the alarm; a slot whose
 * whole subject is the passage of light cannot say anything in four steps an
 * hour that does not read as four jumps. `theming.js` holds the clock that
 * turns a new key into a new question.
 *
 * Generation-forced as well (spec §1.4): the counter moves when the popover
 * opens and when the schedule refreshes, so an answer given before a plugin
 * was reconfigured is not one the page keeps wearing.
 *
 * @param {{date: string, time: string}} now
 * @param {number} generation
 * @returns {string}
 */
export function tokenKey(now, generation) {
  const [hour = '', minute = ''] = now.time.split(':')
  // A time this app did not write is a key rather than a NaN that spreads:
  // `NaN` would stringify into a key that never matches itself and ask the
  // plugin again on every single draw. Base ten explicitly, so this reads the
  // digits `nowTime` writes and nothing else - `Number` would take `0x10` for
  // sixteen and collide two keys that are not the same minute.
  const at = (/** @type {string} */ part) => String(Number.parseInt(part, 10) || 0).padStart(2, '0')
  return `${now.date}:${at(hour)}:${at(minute)}:${generation}`
}

/**
 * The tokens the plugins moved, settled.
 *
 * @param {{plugin: string, value: unknown}[]} answers  in plugin-name order
 * @param {Map<string, string[]>} moves  per plugin, what its manifest declared
 * @returns {{tokens: Map<string, string>, notices: string[]}}
 */
export function readPluginTokens(answers, moves) {
  /** @type {string[]} */
  const notices = []
  const claims = claimed(moves, notices)

  /** @type {Map<string, string>} */
  const tokens = new Map()

  for (const answer of answers) {
    // Nothing to say, which is not the same as the wrong shape: a handler
    // that returned nothing is answering, it just has no colours to move this time.
    if (answer.value === null || answer.value === undefined) continue
    if (typeof answer.value !== 'object' || answer.value === null || Array.isArray(answer.value)) {
      notices.push(`${answer.plugin} returned something that is not a map of tokens`)
      continue
    }

    // Two counters rather than one, because they are two different sentences.
    // A plugin that sent `{paper: 4}` *may* move `paper`, and telling it that
    // it may not would send its author looking at the manifest instead of at
    // the 4.
    let notMine = 0
    let unusable = 0
    // Named while there is one to name, counted once there are several: the
    // token's own name is the useful half of this sentence, and a plugin
    // answering thirteen bad values must not put thirteen lines on the page.
    /** @type {{name: string, why: string}|null} */
    let firstRefused = null
    let refused = 0
    for (const [name, raw] of Object.entries(/** @type {Record<string, unknown>} */ (answer.value))) {
      // The claim is what decides, not the answer: a plugin that declared a
      // token holds it whether or not it happened to answer this time, so the
      // page does not change colour depending on who was slow.
      if (claims.get(name) !== answer.plugin) {
        notMine += 1
        continue
      }
      const value = flatten(raw)
      if (value === '') {
        unusable += 1
        continue
      }
      const why = forbidden(value)
      if (why !== null) {
        refused += 1
        if (firstRefused === null) firstRefused = { name, why: why.why }
        continue
      }
      tokens.set(name, value)
    }

    // Counted, not listed, and at most one notice each per answer (spec §6).
    if (notMine > 0) {
      notices.push(`${answer.plugin} sent ${notMine} ${notMine === 1 ? 'token' : 'tokens'} it may not move`)
    }
    if (unusable > 0) {
      notices.push(`${answer.plugin} sent ${unusable} ${unusable === 1 ? 'value' : 'values'} this app could not use`)
    }
    if (firstRefused !== null) {
      const also = refused === 1 ? '' : ` (and ${refused - 1} more)`
      notices.push(`${answer.plugin}'s ${firstRefused.name} was refused${also} - ${firstRefused.why}`)
    }
  }

  return { tokens: sorted(tokens), notices }
}

/**
 * Who holds each token, and what to say about the ones two plugins wanted.
 *
 * In name order, so which of two overlapping plugins wins is the same on every
 * launch. Colour is not a thing two plugins can each have half of, and the
 * second one is told rather than quietly overwritten.
 *
 * @param {Map<string, string[]>} moves
 * @param {string[]} notices
 * @returns {Map<string, string>} token -> the plugin that may move it
 */
function claimed(moves, notices) {
  /** @type {Map<string, string>} */
  const claims = new Map()

  for (const plugin of [...moves.keys()].sort()) {
    for (const name of moves.get(plugin) ?? []) {
      // A name from a theme this version has never heard of is not a token,
      // and is not worth a line: the pane already shows what was declared.
      if (!TOKEN_NAMES.includes(name)) continue
      const first = claims.get(name)
      if (first !== undefined) {
        notices.push(`${first} and ${plugin} both move ${name}; only ${first} does`)
        continue
      }
      claims.set(name, plugin)
    }
  }
  return claims
}

/**
 * One rule, setting every moved token on `:root`.
 *
 * Empty for nothing moved, so the style element holds nothing rather than an
 * empty rule - absent rather than empty, the same way a section is.
 *
 * @param {Map<string, string>} tokens
 * @returns {string}
 */
export function pluginTokensCss(tokens) {
  if (tokens.size === 0) return ''
  const lines = [':root {']
  for (const [name, value] of sorted(tokens)) lines.push(`  --${name}: ${value};`)
  lines.push('}', '')
  return lines.join('\n')
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function flatten(raw) {
  if (typeof raw !== 'string') return ''
  const line = raw.replace(/\s+/gu, ' ').trim()
  return line.length <= LONGEST ? line : ''
}

/**
 * By name, so the same set of tokens produces the same stylesheet twice - a
 * rule that reshuffles is a diff nobody can read.
 *
 * @param {Map<string, string>} tokens
 * @returns {Map<string, string>}
 */
function sorted(tokens) {
  return new Map([...tokens].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
}
