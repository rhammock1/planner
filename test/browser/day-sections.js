// @ts-check

/**
 * A block's autosave, driven straight against `createDaySections` - no app,
 * no plugin, exactly what `harness.js` exists for (spec §4.2). This is the
 * regression cover Task 11 owed: two prior fixes to this file's caret/disk
 * race had nothing driving `createDaySections` at all, and a third hazard -
 * a block whose file has not been read yet - only becomes reachable once the
 * day page actually asks a store for its blocks, which is this task's own
 * wiring.
 */

import { check, ok, equal, report } from './harness.js'
import { createDaySections } from '../../src/views/daySections.js'

/** @typedef {import('../../src/core/sections.js').Block} Block */

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

/** One editor block, on one day, for every check here - the shape a plugin
 *  answering `page.section` would name for an existing sidecar. @type {Block} */
const BLOCK = { plugin: 'meeting-notes', suffix: 'meeting-standup', title: 'Standup', kind: 'editor' }

/**
 * A fake host that only ever records what it was asked to write - never
 * refuses, never delays - so a check can assert on `written` without a
 * bigger stand-in than the bug needs.
 *
 * @returns {{handlers: import('../../src/views/daySections.js').SectionHandlers, written: {date: string, suffix: string, text: string}[]}}
 */
function recording() {
  /** @type {{date: string, suffix: string, text: string}[]} */
  const written = []
  return {
    handlers: {
      onBlock: async (date, suffix, text) => {
        written.push({ date, suffix, text })
        return true
      },
      onOpen: () => {},
    },
    written,
  }
}

/**
 * @param {import('../../src/views/daySections.js').SectionHandlers} handlers
 * @returns {ReturnType<typeof createDaySections>}
 */
function mount(handlers) {
  stage.replaceChildren()
  const sections = createDaySections(handlers)
  stage.append(sections.element)
  return sections
}

/** @returns {HTMLElement} */
function body() {
  const element = stage.querySelector('.block-body')
  if (!(element instanceof HTMLElement)) throw new Error('no block body')
  return element
}

/** Lets the microtask a fake `onBlock` settles on actually run, without
 *  waiting out the 800ms settle timer this is careful never to need.
 *  @returns {Promise<void>} */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// The first of the two bugs this file used to have with nothing testing it:
// text arriving from disk while the block is focused used to be lost the
// moment the caret left, because blur wrote the stale snapshot back over it.
check('text that arrives while a block is focused is applied on blur, and nothing is written', () => {
  const { handlers, written } = recording()
  const sections = mount(handlers)
  let disk = 'from disk'
  sections.render({ date: '2026-09-01', contributed: [], blocks: [BLOCK], textOf: () => disk })

  body().focus()
  equal(body().textContent, 'from disk', 'the block did not start out showing what disk held')

  // The file changes under the block while it is focused, and a redraw
  // follows - the same shape as the watcher's own redraw after any write.
  disk = 'changed elsewhere'
  sections.render({ date: '2026-09-01', contributed: [], blocks: [BLOCK], textOf: () => disk })
  equal(body().textContent, 'from disk', 'disk was written in while the caret was still there')

  body().blur()
  equal(body().textContent, 'changed elsewhere', 'the arrived text was not applied once the caret left')
  equal(written.length, 0, 'nothing was typed, but a write went out anyway')
})

// The second: reverting a typed edit back to what disk held stopped writing
// at all, once the block's memory of "what disk has" was only ever a
// snapshot taken at focus - so disk kept the mid-edit text forever.
await check('reverting a typed edit to what disk holds still writes it, so disk and screen agree', async () => {
  const { handlers, written } = recording()
  const sections = mount(handlers)
  sections.render({ date: '2026-09-01', contributed: [], blocks: [BLOCK], textOf: () => 'first line' })

  body().focus()
  body().textContent = 'first line and more'
  body().dispatchEvent(new Event('input', { bubbles: true }))
  // Blur forces the write; nobody has to wait out the settle timer to see it.
  body().blur()
  await flush()
  equal(written.length, 1, 'the edit was not written on blur')
  equal(written[0]?.text, 'first line and more', 'the wrong text went out')

  body().focus()
  body().textContent = 'first line'
  body().dispatchEvent(new Event('input', { bubbles: true }))
  body().blur()
  await flush()

  equal(written.length, 2, 'reverting to what disk already held did not write at all')
  equal(written[1]?.text, 'first line', 'the write did not carry the reverted text')
})

// Correction 3: `store.sidecar` answers null both for "no such file" and "not
// read yet", so a block can be on the page for a frame or two before its own
// text arrives. Left editable, a stray keystroke there would write over a
// file nobody has actually seen - so it stays locked until disk answers once.
check('a block whose file has not been read yet cannot be typed into', () => {
  const { handlers } = recording()
  const sections = mount(handlers)
  sections.render({ date: '2026-09-01', contributed: [], blocks: [BLOCK], textOf: () => null })

  equal(body().getAttribute('contenteditable'), 'false', 'a block with no answer yet was left open to type into')
  body().focus()
  ok(document.activeElement !== body(), 'a block nobody has read yet still took the caret')

  sections.render({ date: '2026-09-01', contributed: [], blocks: [BLOCK], textOf: () => 'now on disk' })
  equal(body().getAttribute('contenteditable'), 'plaintext-only', 'text arrived but the block stayed locked')
})

report()
