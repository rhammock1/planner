// @ts-check

/**
 * The item list's keyboard, which only a browser can answer for: what the
 * caret protects, and what it must not.
 *
 * Every bug this page exists to catch had the same shape. The file said one
 * thing, the row on screen said another, and the difference was invisible
 * until the focus moved - by which time the next keystroke had already been
 * pressed against the wrong picture.
 */

import { check, ok, equal, report } from './harness.js'
import { parse } from '../../src/core/parse.js'
import { serialize } from '../../src/core/serialize.js'
import { setItemState, removeItem } from '../../src/core/edit.js'
import { createItemList } from '../../src/views/itemList.js'

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

const PAGE = '# 2026-09-01\n\n- [ ] First\n- [ ] Second\n- [ ] Third\n'

/**
 * A list wired to a document the handlers actually edit, so a check sees the
 * same round trip the app does: edit, re-render, look.
 *
 * @param {string} text
 */
function mount(text = PAGE) {
  stage.replaceChildren()
  let doc = parse(text)
  const list = createItemList({
    onToggle: (index) => {
      const node = doc.nodes[index]
      if (node?.kind !== 'item') return
      doc = setItemState(doc, index, node.state === 'done' ? 'open' : 'done')
      list.render(doc)
    },
    onEdit: async () => true,
    onNote: async () => true,
    onStrike: (index) => {
      const node = doc.nodes[index]
      if (node?.kind !== 'item') return
      doc = node.state === 'dropped' ? removeItem(doc, index) : setItemState(doc, index, 'dropped')
      list.render(doc)
    },
    onRemove: async () => true,
  })
  stage.append(list.element)
  list.render(doc)
  return { list, doc: () => doc }
}

/** @returns {HTMLElement[]} */
const rows = () => [...stage.querySelectorAll('.item')].map((row) => /** @type {HTMLElement} */ (row))

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
function lineSaying(text) {
  const row = rows().find((r) => r.querySelector('.item-text')?.textContent === text)
  if (row === undefined) throw new Error(`no line saying ${text}`)
  return row
}

/**
 * @param {HTMLElement} row
 * @returns {void}
 */
function strike(row) {
  const text = row.querySelector('.item-text')
  if (!(text instanceof HTMLElement)) throw new Error('no text')
  text.focus()
  text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true }))
}

// The cross-out has to be visible before the same keys can delete. A row left
// un-repainted because its own text held the caret is a page inviting you to
// delete something it never showed you striking out.
check('a line crossed out under the caret shows it at once', () => {
  mount()
  const row = lineSaying('Second')
  strike(row)
  equal(lineSaying('Second').className, 'item dropped', 'the row did not repaint')
})

check('the caret stays in the line it crossed out', () => {
  mount()
  strike(lineSaying('Second'))
  const active = document.activeElement
  ok(active instanceof HTMLElement && active.classList.contains('item-text'), 'the caret left the line')
  equal(active instanceof HTMLElement ? active.textContent : null, 'Second', 'the caret moved to another line')
})

check('a second cross-out takes the line off the page', () => {
  const { doc } = mount()
  const row = lineSaying('Second')
  strike(row)
  strike(lineSaying('Second'))
  equal(rows().length, 2, 'the row is still on the page')
  equal(serialize(doc()), '# 2026-09-01\n\n- [ ] First\n- [ ] Third\n', 'the file still has it')
})

// Rows are keyed by position, so removing one shifts every key below it and
// the row element is reused for its neighbour. A caret still sitting in that
// element would hold the departed line's words over the top of the new one.
check('the line below moves up without wearing the deleted line s words', () => {
  mount()
  strike(lineSaying('Second'))
  strike(lineSaying('Second'))
  const said = rows().map((row) => row.querySelector('.item-text')?.textContent)
  equal(said.join(','), 'First,Third', `the list reads ${said.join(',')}`)
})

check('crossing out the last line leaves the others alone', () => {
  mount()
  strike(lineSaying('Third'))
  equal(lineSaying('First').className, 'item open', 'First changed')
  equal(lineSaying('Second').className, 'item open', 'Second changed')
})

// Shift+Enter opens the line underneath. The note starts empty, so nothing
// may hide it back out from under the caret on the next render.
check('Shift+Enter opens the note and the caret lands in it', () => {
  mount()
  const row = lineSaying('First')
  const text = row.querySelector('.item-text')
  if (!(text instanceof HTMLElement)) throw new Error('no text')
  text.focus()
  text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))

  const note = row.querySelector('.item-note')
  ok(note instanceof HTMLElement && !note.hidden, 'the note stayed hidden')
  equal(document.activeElement, note, 'the caret is not in the note')
})

report()
