// @ts-check

/**
 * A note's autosave, driven straight against `createNoteView` - no app, no
 * plugin, exactly what `harness.js` exists for (spec §2.1).
 *
 * This is `day-sections.js` moved with the thing it was watching. Two bugs
 * were found and fixed in the block editor's caret/disk race, and that race
 * came here word for word when the editor became a page of its own -
 * `noteView.js`'s `settle` says as much itself. So the cover comes here too,
 * rather than being deleted along with the region it used to drive.
 *
 * The block's third hazard did not come with them, and that is deliberate: a
 * block could be drawn before disk had answered for it, and a note is only
 * ever opened with its text already in hand (`app.js`'s `showNote` will not
 * open one without). There is nothing left to lock, so there is nothing left
 * to check.
 */

import { check, equal, report } from './harness.js'
import { createNoteView } from '../../src/views/noteView.js'

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

/** The one note every check here opens. */
const NOTE = { date: '2026-09-01', suffix: 'note-standup', title: 'Standup' }

/**
 * A fake host that only ever records what it was asked to write - never
 * refuses, never delays - so a check can assert on `written` without a
 * bigger stand-in than the bug needs.
 *
 * @returns {{handlers: import('../../src/views/noteView.js').NoteHandlers, written: {date: string, suffix: string, text: string}[]}}
 */
function recording() {
  /** @type {{date: string, suffix: string, text: string}[]} */
  const written = []
  return {
    handlers: {
      onWrite: async (date, suffix, text) => {
        written.push({ date, suffix, text })
        return true
      },
      onDelete: async () => true,
      onFollow: () => {},
      onOpenLink: () => {},
      onClose: () => {},
    },
    written,
  }
}

/**
 * @param {import('../../src/views/noteView.js').NoteHandlers} handlers
 * @returns {ReturnType<typeof createNoteView>}
 */
function mount(handlers) {
  stage.replaceChildren()
  const view = createNoteView(handlers)
  stage.append(view.element)
  return view
}

/**
 * The note's first line, re-read every time: a line the view has painted or
 * filled again is a different set of nodes, and half of what these checks
 * watch for is exactly that replacement.
 *
 * @returns {HTMLElement}
 */
function line() {
  const element = stage.querySelector('.nv-body .md')
  if (!(element instanceof HTMLElement)) throw new Error('no line in the note')
  return element
}

/** Lets the microtask a fake `onWrite` settles on actually run, without
 *  waiting out the 800ms settle timer this is careful never to need.
 *  @returns {Promise<void>} */
function flush() {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

/**
 * Types into the line holding the caret, the way the view hears it. A line
 * shows its own source while it holds the caret, so what goes in here is the
 * file's text and not a rendering of it.
 *
 * @param {HTMLElement} element
 * @param {string} text
 * @returns {void}
 */
function type(element, text) {
  element.textContent = text
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

// The first of the two bugs this cover used to sit on: text arriving from
// disk while a line was focused was lost the moment the caret left, because
// blur wrote the stale snapshot back over it. `open` is how disk's copy
// arrives here - `app.js` calls it again on every draw while a note is up -
// and it has to hold that copy rather than apply it.
check('text that arrives while a line is focused is applied on blur, and nothing is written', () => {
  const { handlers, written } = recording()
  const view = mount(handlers)
  view.open({ ...NOTE, text: 'from disk' })

  line().focus()
  equal(line().textContent, 'from disk', 'the note did not start out showing what disk held')

  // The file changes under the note while it is focused, and a draw follows -
  // the same shape as the watcher's own redraw after any write.
  view.open({ ...NOTE, text: 'changed elsewhere' })
  equal(line().textContent, 'from disk', 'disk was written in while the caret was still there')

  line().blur()
  equal(line().textContent, 'changed elsewhere', 'the arrived text was not applied once the caret left')
  equal(written.length, 0, 'nothing was typed, but a write went out anyway')
})

// The second: reverting a typed edit back to what disk held stopped writing
// at all, once the view's memory of "what disk has" was only ever a snapshot
// taken on arriving - so disk kept the mid-edit text forever.
await check('reverting a typed edit to what disk holds still writes it, so disk and screen agree', async () => {
  const { handlers, written } = recording()
  const view = mount(handlers)
  view.open({ ...NOTE, text: 'first line' })

  line().focus()
  type(line(), 'first line and more')
  // Blur forces the write; nobody has to wait out the settle timer to see it.
  line().blur()
  await flush()
  equal(written.length, 1, 'the edit was not written on blur')
  equal(written[0]?.text, 'first line and more', 'the wrong text went out')

  line().focus()
  type(line(), 'first line')
  line().blur()
  await flush()

  equal(written.length, 2, 'reverting to what disk already held did not write at all')
  equal(written[1]?.text, 'first line', 'the write did not carry the reverted text')
})

report()
