// @ts-check

/**
 * What a list of items can have done to it, on whichever page is being shown.
 *
 * The day page and the back page hold the same kind of list and answer the
 * same gestures - tick, retype, annotate, cross out, rub out, add. The only
 * difference between them is which file the change lands in, so that is the
 * only thing this takes as an argument.
 */

import { createDayDocument, createSomedayDocument, createItem } from './core/model.js'
import {
  setItemState, setItemText, setItemNote, removeItem, carriesNothingElse, appendItem, setDailyNote,
} from './core/edit.js'
import { SOMEDAY } from './core/vaultIndex.js'

/** @typedef {import('./core/model.js').Document} Document */

/**
 * @typedef {object} PageEdits
 * @property {(index: number) => void} onToggle
 * @property {(index: number, text: string) => Promise<boolean>} onEdit
 * @property {(index: number, note: string) => Promise<boolean>} onNote
 * @property {(index: number) => void} onStrike
 * @property {(index: number) => Promise<boolean>} onRemove
 * @property {(line: string) => Promise<boolean>} onAdd
 * @property {(note: string) => Promise<boolean>} onDailyNote
 */

/**
 * @param {import('./store.js').Store} store
 * @param {() => string} pageOf  the page being shown, read at the moment of
 *   the change rather than bound once: the day page navigates.
 * @returns {PageEdits}
 */
export function createPageEdits(store, pageOf) {
  /**
   * The one door out of this module.
   *
   * A view that has not drawn yet addresses no page - the week view's seven
   * columns know which day they are only once they have been given a week -
   * and nothing is written to nowhere.
   *
   * @param {(doc: Document|null) => Document|null} mutate
   * @returns {Promise<boolean>}
   */
  function write(mutate) {
    const page = pageOf()
    if (page === '') return Promise.resolve(false)
    return store.change(page, mutate)
  }

  /**
   * @param {number} index
   * @param {(doc: Document, item: import('./core/model.js').Item) => Document|null} mutate
   * @returns {Promise<boolean>}
   */
  function changeItem(index, mutate) {
    return write((doc) => {
      const node = doc?.nodes[index]
      if (doc === null || node === undefined || node.kind !== 'item') return null
      return mutate(doc, node)
    })
  }

  return {
    /**
     * Open becomes done and done becomes open. Migrated and dropped lines are
     * historical record; clicking one brings it back as done rather than
     * pretending it was never settled.
     */
    onToggle: (index) => {
      void changeItem(index, (doc, item) => setItemState(doc, index, item.state === 'done' ? 'open' : 'done'))
    },

    onEdit: (index, text) => changeItem(index, (doc) => setItemText(doc, index, text)),

    /** Writes the line underneath an item. An empty one takes the note away. */
    onNote: (index, note) => changeItem(index, (doc) => setItemNote(doc, index, note)),

    /**
     * Crosses a line out, or takes an already-crossed-out one off the page.
     *
     * `[-]` is the record of a decision, and the page is kept for its records.
     * A second press is how you say the line was never worth one.
     */
    onStrike: (index) => {
      void changeItem(index, (doc, item) => (
        item.state === 'dropped' ? removeItem(doc, index) : setItemState(doc, index, 'dropped')
      ))
    },

    /**
     * Takes a line off the page because its text was rubbed out.
     *
     * Refused when the line carries a time, a deadline or a note: those are
     * worth more than the keystroke that emptied the words, and the text is
     * put back.
     */
    onRemove: (index) => {
      const node = store.page(pageOf())?.nodes[index]
      if (node === undefined || node.kind !== 'item' || !carriesNothingElse(node)) return Promise.resolve(false)
      // Read again inside the write, in case the file moved under us.
      return changeItem(index, (doc, item) => (carriesNothingElse(item) ? removeItem(doc, index) : null))
    },

    /**
     * The line is stored as typed. Any `@time` or `!due` in it is extracted
     * when the file is read back, which is the same path a line typed in nvim
     * takes - so there is one parser, used once, and no second implementation
     * here.
     *
     * Natural-language dates belong to quick add, where a preview makes the
     * reading visible before it is committed (spec §5.2). A line typed here
     * means what it says.
     */
    onAdd: (line) => {
      const text = line.trim()
      if (text === '') return Promise.resolve(false)
      return write((doc) => appendItem(doc ?? blankPage(pageOf()), createItem(text)))
    },

    /** The day's own line, at the bottom of the page. */
    onDailyNote: (note) => write((doc) => (doc === null ? null : setDailyNote(doc, note.trim()))),
  }
}

/**
 * @param {string} page
 * @returns {Document}
 */
function blankPage(page) {
  return page === SOMEDAY ? createSomedayDocument() : createDayDocument(page)
}
