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
import { DEFAULTS, DEFAULT_CONFIG_TEXT, updateConfig } from './core/config.js'
import { createWriteQueue } from './writeQueue.js'
import * as ipc from './ipc.js'
import * as startup from './startup.js'

/** @typedef {import('./core/vaultIndex.js').VaultIndex} VaultIndex */
/** @typedef {import('./core/model.js').Document} Document */

/**
 * @typedef {object} Store
 * @property {(onChanged: () => void) => Promise<{home: string}>} start
 * @property {(path: string) => Promise<void>} useVault
 * @property {() => boolean} vaultExists
 * @property {() => Promise<void>} startPlugins
 * @property {(from: string, to: string) => Promise<void>} loadContributions
 * @property {() => unknown[]} contributions
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
  /** What the plugins said about the last time they were asked.
   *
   *  Kept apart from the rest because they are asked again every time the
   *  popover is opened: appended, a calendar that is not allowed would leave
   *  the same line behind on every open until the page was all notice.
   *  @type {string[]} */
  let pluginNotices = []
  /** Where `~` points, learned when the config was read. */
  let home = ''
  /** False when the configured folder is not there. The page offers a picker
   *  rather than creating one somewhere nobody asked for (spec §8). */
  let vaultExists = false
  /** @type {() => void} */
  let changed = () => {}
  /** Whatever the plugins last returned. Not this app's data; checked on the
   *  way to a page, not here. */
  /** @type {unknown[]} */
  let contributions = []

  /**
   * Reads the config, applies the theme, opens the vault and indexes it.
   *
   * Separate from `start` because it happens again when the vault moves: the
   * theme may be different, the notices certainly are, and the index has to be
   * built from the new folder rather than added to the old one.
   *
   * @returns {Promise<void>}
   */
  async function open() {
    const loaded = await startup.loadConfig()
    config = loaded.config
    home = loaded.home

    const themed = await startup.applyTheme(config.theme)
    const opened = await startup.openVault(config.vault, home)
    vaultExists = opened.exists
    // Replaced rather than added to: reopening a vault that is now there
    // should not leave the line saying it was not.
    notices = [...loaded.notices, ...themed, ...opened.notices]

    const files = await ipc.readVault()
    vault = buildIndex(files.map((file) => ({ page: file.page, doc: parse(file.text) })))
  }

  /**
   * Points the app at a different folder, and writes that down (spec §8).
   *
   * The config is edited rather than regenerated, so a file with comments in
   * it keeps them. A first run has no file at all, and gets the commented
   * default with the chosen path in it.
   *
   * @param {string} path
   * @returns {Promise<void>}
   */
  async function useVault(path) {
    const file = await ipc.readConfig()
    const before = file.text.trim() === '' ? DEFAULT_CONFIG_TEXT : file.text
    await ipc.writeConfig(updateConfig(before, { vault: path }))
    await open()
    changed()
  }

  /**
   * @param {() => void} onChanged
   * @returns {Promise<{home: string}>}
   */
  async function start(onChanged) {
    changed = onChanged
    await open()

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

    return { home }
  }

  /**
   * Starts the plugins the config enables. The popover does this; the other
   * windows do not, because nothing in them shows what a plugin contributes.
   *
   * @returns {Promise<void>}
   */
  async function startPlugins() {
    const said = await startup.startPlugins(config.plugins)
    if (said.length === 0) return
    notices = [...notices, ...said]
    changed()
  }

  /**
   * Asks the plugins what they have for a range of days.
   *
   * Nothing waits for this. The page has already been drawn without them,
   * and is drawn again if and when they answer.
   *
   * @param {string} from
   * @param {string} to
   * @returns {Promise<void>}
   */
  async function loadContributions(from, to) {
    try {
      const given = await ipc.contribute(from, to)
      contributions = given.items
      pluginNotices = given.notices
    } catch (error) {
      contributions = []
      pluginNotices = [`Could not ask the plugins: ${message(error)}`]
    }
    changed()
  }

  return {
    start,
    useVault,
    vaultExists: () => vaultExists,
    startPlugins,
    loadContributions,
    contributions: () => contributions,
    vault: () => vault,
    config: () => config,
    notices: () => [...notices, ...pluginNotices],

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
