// @ts-check

/**
 * The Markdown a note is shown in (spec §2.2).
 *
 * Pure, and deliberately small. Two functions and no DOM, because the view
 * builds nodes from what this returns and never interpolates a string - a
 * note is a file somebody may have pasted anything into.
 *
 * The subset is closed: headings to three, bullets, numbers, quote, bold,
 * italic, strike, code and links. Everything left out is a block structure
 * that spans lines, and the whole model here is that a line is the unit -
 * which is what lets the view show one line's source while rendering the
 * rest.
 *
 * `blockOf` returns the marker rather than the marker's length, and the
 * caret model depends on `marker + text === line` for every line there is.
 * A parser that normalised anything would move somebody's caret.
 */

import { readRef } from './sidecars.js'

/** @typedef {'h1'|'h2'|'h3'|'li'|'ol'|'quote'|'blank'|'p'} BlockKind */

/**
 * @typedef {object} Block
 * @property {BlockKind} kind
 * @property {string} marker  the characters the kind is spelled with, `''` for p and blank
 * @property {string} text  everything after them
 */

/**
 * @typedef {{kind: 'text', text: string}
 *   | {kind: 'code', text: string}
 *   | {kind: 'strong'|'em'|'del', children: Inline[]}
 *   | {kind: 'link', text: string, url: string, where: 'out'|'in'|'dead'}} Inline
 */

/**
 * Longest first, so `### ` is tested before `## ` before `# `.
 * @type {{kind: BlockKind, re: RegExp}[]}
 */
const BLOCKS = [
  { kind: 'h3', re: /^### / },
  { kind: 'h2', re: /^## / },
  { kind: 'h1', re: /^# / },
  { kind: 'li', re: /^[-*] / },
  { kind: 'ol', re: /^\d+\. / },
  { kind: 'quote', re: /^> / },
]

/**
 * What a line is, and the exact characters that say so.
 *
 * @param {string} line
 * @returns {Block}
 */
export function blockOf(line) {
  if (typeof line !== 'string') return { kind: 'blank', marker: '', text: '' }
  for (const block of BLOCKS) {
    const hit = line.match(block.re)
    if (hit !== null) return { kind: block.kind, marker: hit[0], text: line.slice(hit[0].length) }
  }
  return { kind: line.trim() === '' ? 'blank' : 'p', marker: '', text: line }
}

/**
 * Where a link may go.
 *
 * `http`, `https` and `mailto` leave the app through `shell.open`, and Rust
 * checks again on the click. `sidecar:` is the app's own ref and stays inside
 * it. Everything else is drawn as text rather than as a link nothing follows -
 * a dead link that looks live is worse than a line that never claimed to be
 * one.
 *
 * Note what is *not* here: the prefix allowlist `core/urls.js` applies to a
 * plugin's badge. A link in a note is not a plugin's - you typed it - and
 * that list exists to constrain plugins.
 *
 * @param {string} url
 * @returns {'out'|'in'|'dead'}
 */
export function linkTarget(url) {
  if (typeof url !== 'string') return 'dead'
  if (/^https?:\/\/\S/iu.test(url)) return 'out'
  if (/^mailto:\S/iu.test(url)) return 'out'
  if (readRef(url) !== null) return 'in'
  return 'dead'
}

/**
 * Two rules every delimiter obeys, and both are load-bearing.
 *
 * **A delimiter hugs its text.** `(?![\s*])` after the opener and `(?<![\s])`
 * before the closer are what keep `2 * 4 = 8` from turning the middle of an
 * arithmetic line into an italic. In a notes app people write that sentence,
 * and a parser that eats it is wrong far more often than one that misses an
 * emphasis somebody spaced out.
 *
 * **A body may hold the other delimiter.** `(?:[^*]|\*\*)+?` in `em` and
 * `(?:[^*]|\*(?!\*))+?` in `strong` are what let the two nest either way
 * round - `*a **b** c*` and `**a *b* c**` both come out as a tree rather than
 * as three flat runs. A body of `[^*]+` cannot span the inner pair and gets
 * both of them wrong. `code` already nested before these rules did, so
 * emphasis not nesting was an inconsistency rather than a smaller subset.
 *
 * `em`'s `(?<!\*)` and `(?!\*)` keep it off `**bold**` entirely, so the two
 * never race on the same characters. Lazy bodies throughout: measured on
 * unclosed runs of 200-4000 characters, the worst case is under a
 * millisecond.
 *
 * `link`'s url allows one level of balanced parentheses, because a Wikipedia
 * or a Jira address has them and `[^)\s]*` truncates at the first.
 *
 * @type {{kind: 'code'|'link'|'strong'|'del'|'em', re: RegExp}[]}
 */
const INLINE = [
  { kind: 'code', re: /`([^`]+)`/u },
  { kind: 'link', re: /\[([^\]]*)\]\(((?:\([^)\s]*\)|[^)\s])*)\)/u },
  { kind: 'strong', re: /\*\*(?![\s*])((?:[^*]|\*(?!\*))+?)(?<![\s])\*\*/u },
  { kind: 'del', re: /~~(?![\s~])((?:[^~]|~(?!~))+?)(?<![\s])~~/u },
  { kind: 'em', re: /(?<!\*)\*(?![\s*])((?:[^*]|\*\*)+?)(?<![\s])\*(?!\*)/u },
]

/**
 * One line's spans.
 *
 * Leftmost wins, in one pass rather than in layers, and a tie is broken by
 * position rather than by rule order. `` `**x**` `` is a code span whose
 * contents are never looked inside, because `code` matches at 0 and every
 * rule that would reach inside it matches later. Layered replacement - one
 * `replace` per rule over the whole string - gets that wrong, and gets
 * nesting wrong in both directions.
 *
 * @param {string} text
 * @returns {Inline[]}
 */
export function inlineOf(text) {
  /** @type {Inline[]} */
  const out = []
  let rest = typeof text === 'string' ? text : ''

  while (rest !== '') {
    /** @type {{kind: string, hit: RegExpMatchArray}|null} */
    let best = null
    for (const rule of INLINE) {
      const hit = rest.match(rule.re)
      if (hit === null || hit.index === undefined) continue
      if (best === null || hit.index < (best.hit.index ?? 0)) best = { kind: rule.kind, hit }
    }

    if (best === null) {
      out.push({ kind: 'text', text: rest })
      return out
    }

    const at = best.hit.index ?? 0
    if (at > 0) out.push({ kind: 'text', text: rest.slice(0, at) })

    const inner = best.hit[1] ?? ''
    if (best.kind === 'code') {
      out.push({ kind: 'code', text: inner })
    } else if (best.kind === 'link') {
      const url = best.hit[2] ?? ''
      out.push({ kind: 'link', text: inner, url, where: linkTarget(url) })
    } else {
      const kind = /** @type {'strong'|'em'|'del'} */ (best.kind)
      out.push({ kind, children: inlineOf(inner) })
    }

    rest = rest.slice(at + best.hit[0].length)
  }

  return out
}
