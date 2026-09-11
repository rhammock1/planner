// @ts-check

/**
 * A file of your own, filling the detached window (spec §3.3).
 *
 * There is almost nothing here, and that is the point. The editor is
 * `createNoteView` - the same function the day page mounts for a note beside
 * a day - handed a different identity and no `onDelete`. The caret model, the
 * per-line source, the settle race and the held-text-from-disk hold are the
 * hardest code in this app; a second copy of them is not a feature worth
 * having.
 *
 * The wrapper exists because a view in this window is a flex child with a tab
 * above it, and `.note-view` is built as an overlay that covers the day. The
 * class it adds is what `spread.css` uses to put that right.
 */

import { el } from '../ui/dom.js'
import { createNoteView } from './noteView.js'

/** @typedef {import('./noteView.js').NoteHandlers} NoteHandlers */
/** @typedef {import('./spreadPage.js').SpreadState} SpreadState */

/**
 * @param {NoteHandlers} handlers
 * @returns {{
 *   element: HTMLElement,
 *   render: (state: SpreadState) => void,
 *   flush: () => Promise<void>,
 * }}
 */
export function createFileView(handlers) {
  const note = createNoteView(handlers)
  const element = el('div', 'view file-view')
  element.append(note.element)

  return {
    element,

    render: (state) => {
      if (state.file === null) {
        note.close()
        return
      }
      // Offered on every draw, exactly as the day page offers a note: `open`
      // recognises the file it is already showing and holds an arriving copy
      // until the caret leaves, rather than taking the words out from under
      // whoever is typing them.
      note.open(state.file)
    },

    /** Writes the file if it is holding an unsaved edit. */
    flush: () => note.flush(),
  }
}
