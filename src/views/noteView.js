// @ts-check

/**
 * A note, over the day it belongs to (spec §2.1).
 *
 * The same overlay `⌘F` is - it lies over the page, `‹` and Escape put it
 * away, and the day underneath is exactly where it was left. Read
 * `searchPanel.js` first: this is that file's shape with an editor in the
 * middle of it, and `daySections.js` is where its saving comes from.
 *
 * Every line renders, and the line holding the caret shows its own source with
 * the marker dimmed (spec §2.2). That is the whole design, and it is why a
 * note needs a view rather than the one `plaintext-only` block it replaces:
 * per-line rendering needs one element per line.
 *
 * **A line's source is `dataset.raw`, never the nodes drawn from it.** A
 * rendering is lossy by construction - `**bold**` is drawn as a `<strong>`
 * with no asterisks anywhere in it - so re-deriving the source by reading
 * rendered DOM back would quietly eat somebody's text on the first round trip.
 * The one place the two meet is a line showing its source, where the parser's
 * `marker + text === line` makes them the same string.
 *
 * Nodes are built with `createElement`, and there is no `innerHTML` in this
 * file: a note is a file somebody may have pasted anything into, and this app
 * carries no sanitiser (spec §2.2). A link is a `span`, never an `<a>` - an
 * anchor inside a `contenteditable` takes the caret and fights the editor for
 * the click.
 *
 * Saving is the block's contract unchanged: 800 ms after the last keystroke,
 * and on close. There is no Save button here because there is no Save button
 * anywhere else in this app either.
 */

import { el, setText } from '../ui/dom.js'
import { blockOf, inlineOf } from '../core/markdown.js'
import { sidecarPath } from '../core/sidecars.js'

/** @typedef {import('../core/markdown.js').Block} Block */
/** @typedef {import('../core/markdown.js').Inline} Inline */

/**
 * @typedef {object} Note
 * @property {string} date  `YYYY-MM-DD`, the day the note sits beside
 * @property {string} suffix
 * @property {string} title  what the header calls it
 * @property {string} text  the file, whole
 */

/**
 * @typedef {object} NoteHandlers
 * @property {(date: string, suffix: string, text: string) => Promise<boolean>} onWrite
 *   the note's own date, not whatever day is on screen when the write finally
 *   goes: a note is flushed as it is put away, which is exactly the moment the
 *   two can differ
 * @property {(date: string, suffix: string) => Promise<boolean>} onDelete
 * @property {(href: string) => void} onFollow  a `sidecar:` ref from a link in the body
 * @property {(url: string) => void} onOpenLink  http, https or mailto (spec §2.3)
 * @property {() => void} onClose  `‹`, Escape, or a note that has just been deleted
 */

/** How long after the last keystroke a note goes to disk. */
const SETTLE = 800

const STAMP = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
})

/**
 * What the note on screen is holding that disk does not know about yet.
 *
 * The block's bookkeeping, one note at a time rather than a map: this view
 * shows one file and there is nothing to key by. `seen` is the field that did
 * not come with it - a block could be drawn before disk had answered for it,
 * and a note is only ever opened with its text in hand.
 *
 * @typedef {object} Held
 * @property {string} date
 * @property {string} suffix
 * @property {ReturnType<typeof setTimeout>|null} timer
 * @property {string|null} arrived  text that came from disk while the caret
 *   was in the note, waiting for it to leave
 * @property {string} was  what disk is believed to hold - not what was found
 *   on opening. A note autosaves as it is written, so a snapshot taken at open
 *   goes stale the moment the settle timer writes; this is kept current by
 *   every place that actually changes what disk has
 */

/**
 * @param {NoteHandlers} handlers
 * @returns {{
 *   element: HTMLElement,
 *   open: (note: Note) => void,
 *   close: () => void,
 *   isOpen: () => boolean,
 *   showing: () => {date: string, suffix: string}|null,
 *   flush: () => Promise<void>,
 * }}
 */
export function createNoteView(handlers) {
  const back = el('button', 'nv-back', '‹')
  back.setAttribute('type', 'button')
  back.setAttribute('aria-label', 'Back to the day')

  const title = el('b')
  const stamp = el('small')
  const heading = el('div', 'nv-title')
  heading.append(title, stamp)

  const del = el('button', 'nv-del', 'Delete')
  del.setAttribute('type', 'button')

  const head = el('div', 'nv-head')
  head.append(back, heading, del)

  const body = el('div', 'nv-body')

  const path = el('span', 'path')
  const saved = el('span', 'saved')
  const foot = el('div', 'nv-foot')
  foot.append(path, saved)

  const element = el('div', 'note-view')
  element.hidden = true
  element.append(head, body, foot)

  /** @type {Held|null} */
  let held = null

  /** Whether `Delete` is on its second press. */
  let armed = false

  /**
   * What the note says now: every line's own source, and nothing read back off
   * a rendering.
   *
   * @returns {string}
   */
  function sourceOf() {
    /** @type {string[]} */
    const lines = []
    for (const child of body.children) {
      if (child instanceof HTMLElement) lines.push(child.dataset['raw'] ?? '')
    }
    return lines.join('\n')
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  function fill(text) {
    body.replaceChildren(...text.split('\n').map((line) => makeLine(line)))
  }

  /**
   * An edit, however it was made - a keystroke, a paste, or a line split in
   * two. Everything that changes a `dataset.raw` says so here.
   *
   * @returns {void}
   */
  function typed() {
    if (held === null) return
    if (held.timer !== null) clearTimeout(held.timer)
    held.timer = setTimeout(() => { void write() }, SETTLE)
    setText(saved, 'Saving…')
    // A half-pressed delete should not sit armed while you carry on typing.
    disarm()
  }

  /**
   * @returns {Promise<void>}
   */
  async function write() {
    const holding = held
    if (holding === null) return
    if (holding.timer !== null) {
      clearTimeout(holding.timer)
      holding.timer = null
    }

    // Read before the first await, so that `close` - which writes and then
    // empties the body in the same breath - takes the text and not the
    // emptiness that follows it.
    const text = sourceOf()
    if (text === holding.was) {
      setText(saved, 'Saved')
      return
    }

    const done = await handlers.onWrite(holding.date, holding.suffix, text)
    // Only on success: a failed write leaves disk holding the old text, and if
    // `was` claimed otherwise the next flush would compare equal and drop the
    // retry, leaving the edit stranded in the DOM. The footer keeps saying
    // `Saving…` for the same reason - it is not saved - and the notice band is
    // where the failure itself is said.
    if (!done) return
    holding.was = text
    setText(saved, 'Saved')
  }

  /**
   * The caret leaving the note altogether. The block's `focusout`, word for
   * word, because it is the same race: an edit arriving from disk while the
   * caret was in a line, held until the caret left.
   *
   * @returns {void}
   */
  function settle() {
    const holding = held
    if (holding === null) return

    if (sourceOf() === holding.was) {
      // Disk already has this - either nothing was typed, or the settle timer
      // wrote it already. Writing now would be a no-op at best; at worst it
      // would stomp what arrived while the note was focused. Clear the timer,
      // as `write` would, and take what arrived instead.
      if (holding.timer !== null) {
        clearTimeout(holding.timer)
        holding.timer = null
      }
      if (holding.arrived !== null) {
        fill(holding.arrived)
        holding.was = holding.arrived
        holding.arrived = null
      }
      return
    }

    // Disk does not have this yet: write it, and drop whatever arrived rather
    // than applying it - your edit is what the file will hold, and the store's
    // sidecar-changed subscription brings the note back into line on the next
    // draw.
    holding.arrived = null
    void write()
  }

  /** @returns {void} */
  function disarm() {
    if (!armed) return
    armed = false
    setText(del, 'Delete')
  }

  /** Puts the view away, pending write and all. @returns {void} */
  function shut() {
    if (held !== null && held.timer !== null) clearTimeout(held.timer)
    held = null
    element.hidden = true
    body.replaceChildren()
    disarm()
  }

  /**
   * Puts text in over the caret's range, splitting the line wherever that text
   * has a newline in it. Enter is this with a newline and nothing else; a
   * paste is this with whatever was on the clipboard.
   *
   * @param {HTMLElement} line
   * @param {Range} range
   * @param {string} text
   * @returns {void}
   */
  function insert(line, range, text) {
    const raw = line.dataset['raw'] ?? ''
    const from = offsetOf(line, range.startContainer, range.startOffset)
    const to = offsetOf(line, range.endContainer, range.endOffset)
    const parts = text.replace(/\r\n?/gu, '\n').split('\n')
    const first = parts[0] ?? ''
    const last = parts[parts.length - 1] ?? ''

    if (parts.length === 1) {
      line.dataset['raw'] = raw.slice(0, from) + first + raw.slice(to)
      // Redrawn from the new source rather than left as the browser would have
      // made it: this line holds the caret, so it goes on showing its source.
      bare(line)
      caretTo(line, from + first.length)
      typed()
      return
    }

    // The line is cut at the caret: what was in front of it keeps this
    // element, and what was behind it rides on the end of the last line the
    // text brought with it.
    line.dataset['raw'] = raw.slice(0, from) + first
    bare(line)

    let after = line
    for (const middle of parts.slice(1, -1)) {
      const made = makeLine(middle)
      after.after(made)
      after = made
    }
    const tail = makeLine(last + raw.slice(to))
    after.after(tail)
    focusLine(tail, last.length)
    typed()
  }

  back.addEventListener('click', () => handlers.onClose())

  // Armed before it fires, because a note is deleted from a popover by a
  // thumb, and the second press is the whole confirmation this gesture gets
  // (spec §2.4).
  del.addEventListener('click', () => {
    const holding = held
    if (holding === null) return
    if (!armed) {
      armed = true
      setText(del, 'Sure?')
      return
    }
    // The settle timer stops before the file moves: a write landing after the
    // delete would put the note straight back.
    if (holding.timer !== null) {
      clearTimeout(holding.timer)
      holding.timer = null
    }
    void handlers.onDelete(holding.date, holding.suffix).then((done) => {
      // A refused delete leaves the note exactly as it was, still editable and
      // still holding its text; the app says why in the notice band.
      if (!done) return
      shut()
      handlers.onClose()
    })
  })

  del.addEventListener('blur', disarm)

  // Escape belongs to the note while the note is up: the day underneath would
  // otherwise close the whole popover on the first press. On the element
  // rather than the body, so it works from the two buttons too.
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    handlers.onClose()
  })

  body.addEventListener('focusin', (event) => {
    const line = lineOf(event.target)
    if (line !== null) bare(line)
  })

  body.addEventListener('focusout', (event) => {
    const line = lineOf(event.target)
    // A line merged into the one above has nothing to put back: its text went
    // with it, and this element is no longer in the note.
    if (line !== null && line.isConnected) {
      // Read back only from a line that is showing its source. A painted one
      // has spent its markers on the rendering, so taking its `textContent`
      // would write `bold` where the file says `**bold**` - which is what a
      // drag between two lines would otherwise do, by painting the line the
      // text left before that drag's own edit arrives.
      if (line.classList.contains('raw')) line.dataset['raw'] = line.textContent ?? ''
      paint(line)
    }
    const to = event.relatedTarget
    if (to instanceof Node && body.contains(to)) return
    settle()
  })

  body.addEventListener('input', (event) => {
    const line = lineOf(event.target)
    if (line === null) return
    // An edit to a line that is not showing its source is an edit to the
    // rendering, and the rendering is not the file: text dragged out of a
    // painted line arrives here after that line has been painted again. Put
    // the line back the way its source says and let the edit go, rather than
    // taking a rendering for a source and losing the markup in it.
    if (!line.classList.contains('raw')) {
      paint(line)
      return
    }
    // The line is showing its own source, so what it reads as is the file's
    // text rather than a rendering of it.
    const raw = line.textContent ?? ''
    line.dataset['raw'] = raw
    // Only the kind, so a line takes its shape as its marker is typed without
    // rebuilding the text the caret is sitting in.
    shape(line, blockOf(raw))
    typed()
  })

  body.addEventListener('keydown', (event) => {
    disarm()
    const line = lineOf(event.target)
    if (line === null) return
    const range = caretIn(line)
    if (range === null) return

    if (event.key === 'Enter') {
      event.preventDefault()
      insert(line, range, '\n')
      return
    }

    if (event.key === 'Backspace') {
      if (!range.collapsed || offsetOf(line, range.startContainer, range.startOffset) !== 0) return
      const previous = line.previousElementSibling
      if (!(previous instanceof HTMLElement)) return
      event.preventDefault()
      const raw = previous.dataset['raw'] ?? ''
      previous.dataset['raw'] = raw + (line.dataset['raw'] ?? '')
      // The caret moves before the line goes, so the note never sees the focus
      // leave it: a line removed from under the caret blurs to nothing, which
      // reads here as the caret leaving the note and settles it early.
      focusLine(previous, raw.length)
      line.remove()
      typed()
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const up = event.key === 'ArrowUp'
      if (!range.collapsed || !atEdgeRow(line, range, up)) return
      const next = up ? line.previousElementSibling : line.nextElementSibling
      if (!(next instanceof HTMLElement)) return
      event.preventDefault()
      // Back to the end of the line above, on to the start of the one below:
      // the caret carries on in the direction it was already going.
      focusLine(next, up ? (next.dataset['raw'] ?? '').length : 0)
    }
  })

  body.addEventListener('paste', (event) => {
    event.preventDefault()
    const line = lineOf(event.target)
    const range = line === null ? null : caretIn(line)
    if (line === null || range === null) return
    // `plaintext-only` already refuses the formatting; the newlines are put in
    // by hand, so that the lines a paste has in it become lines here too.
    insert(line, range, event.clipboardData?.getData('text/plain') ?? '')
  })

  // A `.mdlink` only exists in a line at rest, and a press on one would move
  // the focus into that line - which `bare`s it, and takes the span out of the
  // document before the click that was aimed at it can land. Refusing the
  // press its default keeps both halves: the span survives to be clicked, and
  // the caret stays where it was, because following a link out of a note is
  // not an edit to the note. A dead link is left alone in both handlers: it is
  // plain text, and a click in plain text puts the caret in it (spec §2.3).
  body.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || liveLink(event.target) === null) return
    event.preventDefault()
  })

  // Followed on the click rather than on that press, so that a link is
  // followed the way anything else is: pressed and released on the same word,
  // and let go of by dragging off it first.
  body.addEventListener('click', (event) => {
    const link = liveLink(event.target)
    if (link === null) return
    const url = link.dataset['url'] ?? ''
    if (link.classList.contains('inward')) handlers.onFollow(url)
    else handlers.onOpenLink(url)
  })

  return {
    element,

    open: (note) => {
      // The note already on screen, spoken about again. This is disk's copy
      // arriving rather than a new note, and it must never take the words out
      // from under whoever is typing them - held, and applied when the caret
      // leaves, exactly as a block holds one.
      if (held !== null && held.date === note.date && held.suffix === note.suffix) {
        if (body.contains(body.ownerDocument.activeElement)) {
          if (note.text !== sourceOf()) held.arrived = note.text
          return
        }
        if (note.text !== sourceOf()) fill(note.text)
        held.was = note.text
        return
      }

      // A different note takes the one on screen away with it, so whatever
      // that one was holding is written now: opening a second note inside the
      // settle window would otherwise lose the last few words typed into the
      // first. Synchronous as far as its own await, so it takes the text off
      // the body before `fill` replaces it below.
      void write()

      element.hidden = false
      setText(title, note.title)
      setText(stamp, `Note · ${STAMP.format(new Date(`${note.date}T00:00:00Z`))}`)
      setText(path, sidecarPath(note.date, note.suffix) ?? '')
      setText(saved, 'Saved')
      disarm()

      held = { date: note.date, suffix: note.suffix, timer: null, arrived: null, was: note.text }
      fill(note.text)
      const first = body.firstElementChild
      if (first instanceof HTMLElement) focusLine(first, 0)
    },

    close: () => {
      // `write` runs as far as its own await before it yields, so the text is
      // taken before the body is emptied out from under it.
      void write()
      shut()
    },

    isOpen: () => !element.hidden,

    showing: () => (held === null ? null : { date: held.date, suffix: held.suffix }),

    /** Writes the note if it is holding an unsaved edit. */
    flush: async () => { await write() },
  }
}

/**
 * @param {string} raw
 * @returns {HTMLElement}
 */
function makeLine(raw) {
  const line = el('div', 'md')
  line.setAttribute('contenteditable', 'plaintext-only')
  line.dataset['raw'] = raw
  paint(line)
  return line
}

/**
 * What a line is, said on the element for the CSS to draw from.
 *
 * An ordered item carries the number its own marker spells, rather than a CSS
 * counter: the marker is the source of truth, and a counter would renumber
 * lines the file does not renumber.
 *
 * @param {HTMLElement} line
 * @param {Block} block
 * @returns {void}
 */
function shape(line, block) {
  line.dataset['kind'] = block.kind
  if (block.kind !== 'ol') {
    delete line.dataset['num']
    return
  }
  const number = Number.parseInt(block.marker, 10)
  line.dataset['num'] = Number.isNaN(number) ? '' : String(number)
}

/**
 * A line at rest: rendered, with its markers spent on the rendering.
 *
 * @param {HTMLElement} line
 * @returns {void}
 */
function paint(line) {
  const block = blockOf(line.dataset['raw'] ?? '')
  shape(line, block)
  line.classList.remove('raw')
  // An empty line keeps its height from a `<br>`, because there is no text in
  // it to give the line box one.
  line.replaceChildren(...(block.text === '' ? [el('br')] : nodesOf(inlineOf(block.text))))
}

/**
 * A line under the caret: its own source, with the marker dimmed.
 *
 * One text node and nothing else after the marker, so that what this element
 * reads back as is exactly the line the file holds - which the parser
 * guarantees, since `marker + text === line` for every line there is.
 *
 * @param {HTMLElement} line
 * @returns {void}
 */
function bare(line) {
  const block = blockOf(line.dataset['raw'] ?? '')
  shape(line, block)
  line.classList.add('raw')

  /** @type {Node[]} */
  const nodes = []
  if (block.marker !== '') nodes.push(el('span', 'tok', block.marker))
  nodes.push(document.createTextNode(block.text))
  line.replaceChildren(...nodes)
}

/**
 * One line's inline tokens, as nodes.
 *
 * Built rather than interpolated, all the way down: this is the rule
 * `core/tokens.js` already applies to anything a plugin says, and a note is
 * the same kind of text - it arrives from somewhere else and lands in this
 * app's DOM.
 *
 * @param {Inline[]} tokens
 * @returns {Node[]}
 */
function nodesOf(tokens) {
  /** @type {Node[]} */
  const nodes = []
  for (const token of tokens) {
    if (token.kind === 'text') {
      nodes.push(document.createTextNode(token.text))
    } else if (token.kind === 'code') {
      nodes.push(el('span', 'mdcode', token.text))
    } else if (token.kind === 'link') {
      // A `span`, never an `<a>`: inside a `contenteditable` an anchor takes
      // the caret and fights the editor for the click. Two looks, because one
      // leaves the app and the other does not - and a third for a link this
      // app will not follow, which is drawn as the plain text it is (§2.3).
      const where = token.where === 'in' ? ' inward' : token.where === 'dead' ? ' dead' : ''
      const link = el('span', `mdlink${where}`, token.text)
      link.dataset['url'] = token.url
      nodes.push(link)
    } else {
      const wrap = el(token.kind === 'strong' ? 'strong' : token.kind === 'em' ? 'em' : 'del')
      wrap.append(...nodesOf(token.children))
      nodes.push(wrap)
    }
  }
  return nodes
}

/**
 * The live link a press landed on, or null.
 *
 * A dead link is not one here either: it renders as the plain text it is, and
 * nothing follows it (spec §2.3).
 *
 * @param {EventTarget|null} target
 * @returns {HTMLElement|null}
 */
function liveLink(target) {
  if (!(target instanceof HTMLElement)) return null
  if (!target.classList.contains('mdlink') || target.classList.contains('dead')) return null
  return target
}

/**
 * The line an event happened in, or null if it happened somewhere else.
 *
 * @param {EventTarget|null} target
 * @returns {HTMLElement|null}
 */
function lineOf(target) {
  if (!(target instanceof Node)) return null
  const element = target instanceof HTMLElement ? target : target.parentElement
  const line = element?.closest('.md') ?? null
  return line instanceof HTMLElement ? line : null
}

/**
 * The caret, when it is in this line.
 *
 * @param {HTMLElement} line
 * @returns {Range|null}
 */
function caretIn(line) {
  const selection = line.ownerDocument.defaultView?.getSelection() ?? null
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return line.contains(range.startContainer) ? range : null
}

/**
 * How many characters of the line come before a point in it.
 *
 * Measured with a range rather than by walking, so that the marker's own span
 * counts as the characters it holds and nothing has to know the shape of the
 * line it is counting through.
 *
 * @param {HTMLElement} line
 * @param {Node} node
 * @param {number} offset
 * @returns {number}
 */
function offsetOf(line, node, offset) {
  const before = line.ownerDocument.createRange()
  before.selectNodeContents(line)
  before.setEnd(node, offset)
  return before.toString().length
}

/**
 * Puts the caret that many characters into the line, or at its end if the line
 * is shorter than that.
 *
 * @param {HTMLElement} line
 * @param {number} at
 * @returns {void}
 */
function caretTo(line, at) {
  const doc = line.ownerDocument
  const range = doc.createRange()
  range.selectNodeContents(line)
  range.collapse(false)

  const walker = doc.createTreeWalker(line, NodeFilter.SHOW_TEXT)
  let left = at
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (left <= length) {
      range.setStart(node, left)
      range.collapse(true)
      break
    }
    left -= length
  }

  const selection = doc.defaultView?.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * @param {HTMLElement} line
 * @param {number} at
 * @returns {void}
 */
function focusLine(line, at) {
  // `focus()` dispatches `focusin` synchronously, so by the time the caret is
  // placed the line is already showing its own source and the offset means
  // what it says.
  line.focus()
  caretTo(line, at)
}

/**
 * Whether the caret is on the line's first drawn row, or its last.
 *
 * Each line is its own editing host, so the arrows move the caret between the
 * rows *this* element wraps onto and never off the end of it - and the rows
 * are found by measuring, because where a line breaks is the layout's business
 * and nobody else's.
 *
 * @param {HTMLElement} line
 * @param {Range} range  the caret
 * @param {boolean} up
 * @returns {boolean}
 */
function atEdgeRow(line, range, up) {
  const edge = line.ownerDocument.createRange()
  edge.selectNodeContents(line)
  edge.collapse(up)
  const here = range.getBoundingClientRect()
  const there = edge.getBoundingClientRect()
  // An empty line, or an engine that will not measure a collapsed range in
  // one: there is a single row to be on, and this is it.
  if (here.height === 0 || there.height === 0) return true
  return Math.abs(here.top - there.top) < 1
}
