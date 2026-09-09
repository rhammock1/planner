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
import { DEFAULTS, DEFAULT_CONFIG_TEXT, updateConfig, updatePlugin } from './core/config.js'
import { createGranted } from './plugins/granted.js'
import { LEDGER } from './core/theme.js'
import { createWriteQueue } from './writeQueue.js'
import { createAsking } from './plugins/asking.js'
import { createSidecars } from './sidecarStore.js'
import * as ipc from './ipc.js'
import * as startup from './startup.js'
import { today, nowTime } from './clock.js'

/** @typedef {import('./core/vaultIndex.js').VaultIndex} VaultIndex */
/** @typedef {import('./core/installed.js').Installed} Installed */
/** @typedef {import('./core/model.js').Document} Document */

/**
 * @typedef {object} Store
 * @property {(onChanged: () => void) => Promise<{home: string}>} start
 * @property {(patch: Partial<Omit<import('./core/config.js').Config, 'plugins'>>) => Promise<void>} saveConfig
 * @property {(name: string, settings: import('./core/config.js').PluginConfig) => Promise<void>} savePlugin
 * @property {() => import('./core/plugins.js').Folder[]} folders
 * @property {() => boolean} vaultExists
 * @property {() => Promise<void>} syncPlugins
 * @property {(slot: string, key: string, params: Record<string, unknown>) => {plugin: string, value: unknown}[]} pluginAnswers
 * @property {() => void} refreshPlugins
 * @property {() => number} pluginGeneration
 * @property {() => import('./ipc/host.js').PluginState[]} pluginStates
 * @property {(name: string) => string[]} approvedOpen  addresses a plugin may open, from the pane
 * @property {() => Installed[]} installed  every plugin the two files describe
 * @property {() => Map<string, string[]>} pluginMoves  what each plugin was ticked to move
 * @property {() => Map<string, string>} themeTokens  the theme's own, before any plugin
 * @property {() => VaultIndex} vault
 * @property {() => import('./core/config.js').Config} config
 * @property {() => string[]} notices
 * @property {(message: string) => void} notice
 * @property {(page: string) => Document|null} page
 * @property {(pages: Iterable<string>) => VaultIndex} freshest
 * @property {(page: string, mutate: (doc: Document|null) => Document|null) => Promise<boolean>} change
 * @property {(date: string, suffix: string) => string|null} sidecar
 * @property {(date: string) => {suffix: string, title: string}[]} sidecarsOn
 * @property {(date: string, suffix: string, text: string) => Promise<boolean>} changeSidecar
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
  /** What syncing the plugins last said - a manifest that could not be read,
   *  a plugin that would not start or stop.
   *
   *  Kept apart from the rest because a sync happens every time the popover
   *  is opened: appended, a problem that has since been fixed would leave the
   *  same line behind on every open until the page was all notice.
   *  @type {string[]} */
  let pluginNotices = []
  /** Where `~` points, learned when the config was read. */
  let home = ''
  /** Every plugin folder on disk, whether switched on or not. The settings
   *  pane lists these, so it has to know about the ones that are off.
   *  @type {import('./core/plugins.js').Folder[]} */
  let folders = []

  /** The theme's own tokens, as `applyTheme` resolved them. Ledger's until a
   *  config has been read, so a `theme.tokens` plugin asked before then is
   *  shown a complete set rather than nothing.
   *  @type {Map<string, string>} */
  let themeTokens = LEDGER.tokens

  /** False when the configured folder is not there. The page offers a picker
   *  rather than creating one somewhere nobody asked for (spec §8). */
  let vaultExists = false
  /** @type {() => void} */
  let changed = () => {}

  // Which plugins are up, and what they have said. Every window has one; only
  // the popover ever calls `sync`, because the popover is the window that
  // always exists (spec §1.3).
  const plugins = createAsking({
    startPlugin: ipc.startPlugin,
    stopPlugin: ipc.stopPlugin,
    askPlugins: ipc.askPlugins,
    pluginStates: ipc.pluginStates,
    now: () => ({ date: today(), time: nowTime() }),
    onChanged: () => changed(),
  })

  // What the two files grant each plugin. Getters rather than values, because
  // all three of these are replaced when the config is read again.
  const granted = createGranted({
    folders: () => folders,
    plugins: () => config.plugins,
    states: plugins.states,
  })

  // Files beside a day: what each says, and how a change to one reaches disk
  // (sidecarStore.js). Its own module for the same reason `granted.js` is -
  // this is the part of the store that is not about the day index.
  const sidecars = createSidecars({
    onChanged: () => changed(),
    notice: (line) => { notices = [...notices, line] },
  })

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
    themeTokens = themed.tokens
    const opened = await startup.openVault(config.vault, home)
    vaultExists = opened.exists
    // Replaced rather than added to: reopening a vault that is now there
    // should not leave the line saying it was not.
    notices = [...loaded.notices, ...themed.notices, ...opened.notices]

    const found = await startup.listPlugins()
    folders = found.folders
    notices = [...notices, ...found.notices]

    const files = await ipc.readVault()
    vault = buildIndex(files.map((file) => ({ page: file.page, doc: parse(file.text) })))

    // A vault that has moved is a vault whose notes are somebody else's.
    sidecars.reopen()
  }

  /**
   * Writes settings to `config.toml` and reads the whole file back.
   *
   * Edited rather than regenerated, so a file with comments in it keeps them.
   * A first run has no file at all and gets the commented default (spec §3.6).
   *
   * Read back rather than assumed: a theme that is not there, a folder that
   * does not exist and a hotkey another app already holds are all things the
   * page has to say, and it only learns them by opening again.
   *
   * @param {(text: string) => string} edit
   * @returns {Promise<void>}
   */
  async function save(edit) {
    const file = await ipc.readConfig()
    await ipc.writeConfig(edit(file.text.trim() === '' ? DEFAULT_CONFIG_TEXT : file.text))
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

    try {
      await sidecars.start()
    } catch (error) {
      notices = [...notices, `Notes will save but not appear: ${message(error)}`]
    }

    return { home }
  }

  return {
    start,
    saveConfig: (patch) => save((text) => updateConfig(text, patch)),

    /**
     * Writes settings to `config.toml`, then brings what is running into
     * line with what the file now says: a pane write is the one thing that
     * changes a plugin while the app is up.
     */
    savePlugin: async (name, settings) => {
      await save((text) => updatePlugin(text, name, settings))
      const said = await plugins.sync(folders, config.plugins)
      pluginNotices = said
      changed()
    },

    folders: () => folders,
    vaultExists: () => vaultExists,

    /**
     * Brings what is running into line with what the two files say. The
     * popover does this; the other windows do not, because nothing in them
     * asks a plugin for anything (spec §1.3).
     */
    syncPlugins: async () => {
      const said = await plugins.sync(folders, config.plugins)
      pluginNotices = said
      changed()
    },
    pluginAnswers: plugins.answers,
    refreshPlugins: plugins.refresh,
    pluginGeneration: plugins.generation,
    pluginStates: plugins.states,

    approvedOpen: granted.approvedOpen,
    installed: granted.installed,
    pluginMoves: granted.moves,

    themeTokens: () => themeTokens,
    vault: () => vault,
    config: () => config,
    notices: () => [...notices, ...pluginNotices, ...plugins.notices()],

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

    sidecar: sidecars.text,
    sidecarsOn: sidecars.on,
    changeSidecar: sidecars.change,
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
