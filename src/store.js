// @ts-check

/**
 * The vault as the frontend sees it, and the one path a change takes to disk.
 *
 * Every window is a separate webview with its own copy of this: its own
 * config, its own index, its own subscription to the watcher. They do not
 * share memory, and they do not need to - the file is what they share, and
 * an edit made in either arrives in both by the same route (spec §4.1).
 *
 * The mutable state of a window lives here and nowhere else, so a view is a
 * function of what this holds rather than a place things accumulate.
 */

import { parse } from './core/parse.js'
import { serialize } from './core/serialize.js'
import { buildIndex, getPage, withPage } from './core/vaultIndex.js'
import { DEFAULTS } from './core/config.js'
import { createWriteQueue } from './writeQueue.js'
import * as ipc from './ipc.js'
import * as startup from './startup.js'

/** @typedef {import('./core/vaultIndex.js').VaultIndex} VaultIndex */
/** @typedef {import('./core/model.js').Document} Document */

/**
 * @typedef {object} Store
 * @property {(onChanged: () => void) => Promise<{home: string}>} start
 * @property {() => VaultIndex} vault
 * @property {() => import('./core/config.js').Config} config
 * @property {() => string[]} notices
 * @property {(message: string) => void} notice
 * @property {(page: string) => Document|null} page
 * @property {(pages: Iterable<string>) => VaultIndex} freshest
 * @property {(page: string, mutate: (doc: Document|null) => Document|null) => Promise<boolean>} change
 */

/**
 * @returns {Store}
 */
export function createStore() {
  // One change at a time, and nothing reads a page it has just written but
  // not yet seen come back (see writeQueue.js).
  const writes = createWriteQueue(async (page, doc) => { await ipc.writePage(page, serialize(doc)) })

  /** @type {VaultIndex} */
  let vault = buildIndex([])
  /** @type {import('./core/config.js').Config} */
  let config = DEFAULTS
  /** @type {string[]} */
  let notices = []
  /** @type {() => void} */
  let changed = () => {}

  /**
   * @param {() => void} onChanged
   * @returns {Promise<{home: string}>}
   */
  async function start(onChanged) {
    changed = onChanged

    const loaded = await startup.loadConfig()
    config = loaded.config
    notices = [...notices, ...loaded.notices]
    notices = [...notices, ...await startup.applyTheme(config.theme)]
    notices = [...notices, ...await startup.openVault(config.vault, loaded.home)]

    const files = await ipc.readVault()
    vault = buildIndex(files.map((file) => ({ page: file.page, doc: parse(file.text) })))

    // One subscription, for every change: this window's writes, the other
    // window's writes, and an edit made in nvim all arrive here by the same
    // path.
    //
    // Which makes losing it fatal in a way that looks like nothing at all:
    // the write still lands on disk, and the screen never moves. Said out
    // loud rather than left in a console nobody has open.
    try {
      await ipc.onVaultChanged(async (page) => {
        const text = await ipc.readPage(page)
        vault = withPage(vault, page, text === null ? null : parse(text))
        // Whatever we may have written to this page has now arrived, so the
        // file is the only thing worth believing about it.
        writes.observed(page)
        changed()
      })
    } catch (error) {
      notices = [...notices, `Edits will save but not appear: ${message(error)}`]
    }

    return { home: loaded.home }
  }

  return {
    start,
    vault: () => vault,
    config: () => config,
    notices: () => notices,

    notice: (text) => {
      notices = [...notices, text]
      changed()
    },

    page: (page) => getPage(vault, page),

    /**
     * The index, with the named pages brought up to whatever has been written
     * but not yet read back. For a decision taken across several pages at
     * once, where an item added a moment ago may still be in the post.
     */
    freshest: (pages) => {
      let fresh = vault
      for (const page of pages) {
        fresh = withPage(fresh, page, writes.current(page, () => getPage(vault, page)))
      }
      return fresh
    },

    /**
     * The one place a document leaves the app. Nothing else writes.
     */
    change: async (page, mutate) => {
      try {
        return await writes.change(page, () => getPage(vault, page), mutate)
      } catch (error) {
        // The atomic write means the file on disk is untouched. Say so, and
        // leave what the user typed where it is (spec §8).
        notices = [...notices, `Could not save ${page}: ${message(error)}`]
        changed()
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
