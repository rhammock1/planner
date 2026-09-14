// @ts-check

/**
 * Reading a picture a plugin drew (spec §5.1).
 *
 * A plugin that draws returns SVG as a string, and the app puts it on the page
 * as `<img src="data:image/svg+xml,…">`. The `<img>` is the isolation: it is an
 * independent document that runs no script, loads no subresource and reaches
 * nothing around it. This module is the belt over those braces.
 *
 * Belt rather than the only strap, and worth being honest about which is which.
 * If this reader let something through, an `<img>` would still refuse to run
 * it. What this reader buys is a *refusal that says why*: a plugin author sees
 * `pet sent a picture with a <script> in it` instead of a silently blank
 * margin, and a picture that would not have drawn is never drawn half-way.
 *
 * Pure, and deliberately parsing rather than borrowing `DOMParser`. Everything
 * in `core` is tested under `node --test` with no DOM in the room, and a rule
 * that can only be checked in a browser is a rule the test suite cannot hold
 * anybody to.
 */

/** As much picture as a creature in a margin has any business being. */
export const LONGEST = 16 * 1024

/**
 * Elements a picture may not contain, whatever an `<img>` would have done with
 * them. `foreignObject` is the interesting one: it is the door out of SVG and
 * into HTML, which is the door this whole design exists to keep shut.
 *
 * Two entries, and deliberately not more. `<use>` and `<image>` were on this
 * list while it was being written, and came off: both are ordinary drawing
 * elements, and what was actually worrying about them - reaching something
 * outside the picture - is what the `href` rule below refuses, on every element
 * at once. A reader that quietly forbids more than the spec it implements is a
 * reader that breaks a legitimate plugin a year later for a reason nobody can
 * find.
 */
const REFUSED = new Set(['script', 'foreignobject'])

/** `<?…?>`, `<!DOCTYPE…>`, `<![CDATA[…]]>`: none of it belongs in an answer. */
const PROLOGUE = /^<[?!]/

/**
 * @typedef {object} Picture
 * @property {string} svg  the document, exactly as the plugin wrote it
 */

/**
 * Whether a string is a picture this app will draw, and why not when it is not.
 *
 * The complaint is written to be read by whoever has to fix it, which is the
 * plugin's author rather than the person running the app - so it names the
 * thing found rather than the rule broken.
 *
 * @param {unknown} svg
 * @returns {{picture: Picture}|{refused: string}}
 */
export function readPicture(svg) {
  if (typeof svg !== 'string') return { refused: 'sent a picture that is not text' }
  if (svg.trim() === '') return { refused: 'sent an empty picture' }

  // Bytes rather than characters. The cap is on what has to be carried through
  // an IPC message and a data URI, and one emoji is four of those.
  const bytes = new TextEncoder().encode(svg).length
  if (bytes > LONGEST) {
    return { refused: `sent a ${Math.round(bytes / 1024)} KiB picture, over the ${LONGEST / 1024} KiB limit` }
  }

  return walk(svg)
}

/**
 * Walks the tags, checking the four things that matter: one root, and it is an
 * `svg`; nothing refused inside it; no link that leaves the document; no
 * handler on anything.
 *
 * Not a conforming XML parser and not trying to be. It is strict in the one
 * direction that counts - it refuses what it does not understand - so the ways
 * it differs from a real parser all end in a picture not being drawn.
 *
 * @param {string} svg
 * @returns {{picture: Picture}|{refused: string}}
 */
function walk(svg) {
  let at = 0
  let depth = 0
  let rooted = false
  let closed = false

  while (at < svg.length) {
    const opens = svg.indexOf('<', at)
    if (opens === -1) break

    // Text between tags. Only whitespace may sit outside the root element;
    // anything else means this is not one document.
    if (closed && svg.slice(at, opens).trim() !== '') {
      return { refused: 'sent a picture with text after the </svg>' }
    }
    at = opens

    if (svg.startsWith('<!--', at)) {
      const ends = svg.indexOf('-->', at + 4)
      if (ends === -1) return { refused: 'sent a picture with a comment that never ends' }
      at = ends + 3
      continue
    }
    if (PROLOGUE.test(svg.slice(at, at + 2))) {
      return { refused: 'sent a picture carrying a doctype, CDATA or processing instruction' }
    }

    const ends = svg.indexOf('>', at)
    if (ends === -1) return { refused: 'sent a picture with a tag that never ends' }
    const tag = svg.slice(at + 1, ends)
    at = ends + 1

    if (tag.startsWith('/')) {
      depth -= 1
      if (depth < 0) return { refused: 'sent a picture that closes a tag it never opened' }
      if (depth === 0) closed = true
      continue
    }

    const name = (tag.match(/^[^\s/>]+/)?.[0] ?? '').toLowerCase()
    if (name === '') return { refused: 'sent a picture with a nameless tag' }

    if (!rooted) {
      if (name !== 'svg') return { refused: `sent a picture whose outermost tag is <${name}> rather than <svg>` }
      rooted = true
    } else if (closed) {
      return { refused: 'sent a picture holding more than one document' }
    }

    if (REFUSED.has(name)) return { refused: `sent a picture with a <${name}> in it` }

    const complaint = attributes(tag)
    if (complaint !== null) return { refused: complaint }

    if (!tag.endsWith('/')) depth += 1
  }

  if (!rooted) return { refused: 'sent a picture with no <svg> in it' }
  if (depth !== 0) return { refused: 'sent a picture with a tag left open' }
  if (svg.slice(at).trim() !== '') return { refused: 'sent a picture with text after the </svg>' }
  return { picture: { svg } }
}

/**
 * What is wrong with a tag's attributes, or null when nothing is.
 *
 * Two rules. A link may point within the picture and nowhere else, so
 * `href="#face"` is fine and `href="https://…"` is not - a picture that can
 * fetch is a picture that can report that it was looked at. And nothing may
 * carry a handler, which an `<img>` would never have run anyway, but which is
 * worth refusing out loud rather than accepting and ignoring.
 *
 * @param {string} tag  the text between `<` and `>`
 * @returns {string|null}
 */
function attributes(tag) {
  const found = tag.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"|([:\w-]+)\s*=\s*'([^']*)'/g)
  for (const one of found) {
    const name = (one[1] ?? one[3] ?? '').toLowerCase()
    const value = (one[2] ?? one[4] ?? '').trim()

    if (name.startsWith('on')) return `sent a picture with an ${name} handler on it`
    if (name === 'href' || name.endsWith(':href')) {
      if (!value.startsWith('#')) return `sent a picture linking to ${value || 'nowhere'}`
    }
  }
  return null
}
