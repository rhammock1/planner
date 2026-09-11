// @ts-check

/**
 * The one file the window has open by name: what it says, and how an edit to
 * it reaches disk (spec §2.2).
 *
 * `core/files.js` is the rule - what a file is called, where it sits, whether
 * the watcher will ever see it. This is a different thing: what a window is
 * *holding*, which is the text, the write queue, and the subscription that
 * keeps the two in step.
 *
 * Sibling of `sidecarStore.js`, deliberately: the hazard is the same one over
 * a different document. An edit takes the same route everything in this app
 * takes - mutate, queue, write, watcher, re-read - and disk stays the truth.
 *
 * One file, not a map. The window shows one, and a second `planner <path>`
 * replaces it (spec §3.3), so there is nothing to key by.
 */

import { createWriteQueue } from './writeQueue.js'
import * as ipc from './ipc.js'

/**
 * @typedef {object} FileDeps
 * @property {() => void} onChanged  redraw: a read landed, or a write did
 * @property {(line: string) => void} notice  a line for the window's notice band
 */

/**
 * @typedef {object} OpenFile
 * @property {string} path  absolute
 * @property {string} text
 * @property {boolean} exists  false for a file that is not on disk yet, which
 *   is what the footer says `New file` from
 */

/**
 * @typedef {object} Files
 * @property {() => Promise<void>} start  subscribes to the watcher; rejects if it cannot
 * @property {(path: string) => Promise<void>} open
 * @property {() => void} close
 * @property {() => OpenFile|null} showing
 * @property {(path: string, text: string) => Promise<boolean>} change
 */

/**
 * @param {FileDeps} deps
 * @returns {Files}
 */
export function createFiles(deps) {
  const writes = createWriteQueue(
    /** @type {(path: string, text: string) => Promise<void>} */
    (async (path, text) => { await ipc.writeFile(path, text) }),
  )

  /** What the window is holding. `held` rather than `open`, because `open`
   *  is the name of the method below that replaces it. @type {OpenFile|null} */
  let held = null

  return {
    async start() {
      await ipc.onFileChanged(async (path) => {
        // The registry in Rust names one file, and so does this: a change to
        // anything else is not this window's business, and reading it would
        // be a round trip for a file nobody is looking at.
        if (held === null || held.path !== path) return
        const text = await ipc.readFile(path)
        // Whatever we may have written to this file has now arrived, so the
        // file is the only thing worth believing about it.
        writes.observed(path)
        held = { path, text: text ?? '', exists: text !== null }
        deps.onChanged()
      })
    },

    /**
     * Reads a file and makes it the one this window is showing.
     *
     * A read that fails leaves nothing open rather than an empty editor over
     * a file that might have text in it: writing into that would put the
     * emptiness on disk.
     */
    async open(path) {
      try {
        const text = await ipc.readFile(path)
        held = { path, text: text ?? '', exists: text !== null }
      } catch (error) {
        held = null
        deps.notice(`Could not open ${path}: ${message(error)}`)
      }
      deps.onChanged()
    },

    close: () => {
      held = null
      deps.onChanged()
    },

    /**
     * What the window should draw: the text last written if it has not come
     * back from disk yet, otherwise what disk said.
     */
    showing: () => {
      if (held === null) return null
      return {
        path: held.path,
        text: writes.current(held.path, () => held?.text ?? '') ?? '',
        exists: held.exists,
      }
    },

    /** The one place such a file leaves the app. */
    change: async (path, text) => {
      try {
        const done = await writes.change(path, () => held?.text ?? '', () => text)
        // It is on disk now, so the footer stops calling it new.
        if (done && held !== null && held.path === path) held.exists = true
        return done
      } catch (error) {
        deps.notice(`Could not save ${path}: ${message(error)}`)
        deps.onChanged()
        return false
      }
    },
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
