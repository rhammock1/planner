// @ts-check

/**
 * Bringing the app up: the config file, the theme, the vault, the shortcut.
 *
 * Each of these reaches outside the app for something that may not be there -
 * a folder that was moved, a theme that was deleted, a shortcut another app
 * already holds - and none of them is fatal. So each returns what it could not
 * do as a notice for the page to show, rather than throwing or, worse, going
 * quiet (spec §8).
 */

import { readConfig as parseConfig, expandHome } from './core/config.js'
import { readTheme as parseTheme, themeCss, LEDGER } from './core/theme.js'
import { plan } from './core/plugins.js'
import * as ipc from './ipc.js'

/** @typedef {import('./core/config.js').Config} Config */

/**
 * @returns {Promise<{config: Config, home: string, notices: string[]}>}
 */
export async function loadConfig() {
  const file = await ipc.readConfig()
  const result = parseConfig(file.text)
  return { config: result.config, home: file.home, notices: result.notices }
}

/**
 * Tokens first, then the theme's own stylesheet, both after the app's CSS so
 * a theme can override anything it sets.
 *
 * @param {string} name
 * @returns {Promise<string[]>} notices
 */
export async function applyTheme(name) {
  const folder = await ipc.readTheme(name)
  const result = folder.toml === '' ? { theme: LEDGER, notices: [] } : parseTheme(folder.toml)

  styleElement('theme-tokens').textContent = themeCss(result.theme)
  styleElement('theme-css').textContent = folder.css
  document.documentElement.style.colorScheme = result.theme.appearance
  return result.notices
}

/**
 * Every plugin folder in `~/.planner/plugins`, installed or not.
 *
 * Read whether or not any of them will be started: the settings pane lists
 * the ones that are switched off, and that list is what switches them on.
 *
 * @returns {Promise<{folders: import('./core/plugins.js').Folder[], notices: string[]}>}
 */
export async function listPlugins() {
  try {
    return { folders: await ipc.listPlugins(), notices: [] }
  } catch (error) {
    return { folders: [], notices: [`Could not look for plugins: ${message(error)}`] }
  }
}

/**
 * Points the shell at the vault and starts the watcher on it.
 *
 * A vault that is not there is reported rather than created: the app does not
 * put a folder somewhere the user did not ask for (spec §8).
 *
 * @param {string} vault  the configured path, `~` and all
 * @param {string} home
 * @returns {Promise<{exists: boolean, notices: string[]}>}
 */
export async function openVault(vault, home) {
  const path = expandHome(vault, home)
  const { exists, watching } = await ipc.setVault(path)
  if (!exists) {
    return {
      exists: false,
      notices: [`No vault at ${path}. Choose a folder to keep your pages in, or set one in config.toml.`],
    }
  }

  // Both of these are an app that looks exactly like a working one until you
  // edit a page in a text editor and wait for it to appear (spec §8).
  if (watching === 'polling') {
    return { exists, notices: ['Watching the vault the slow way: an edit made elsewhere takes a couple of seconds to show.'] }
  }
  if (watching === 'none') {
    return { exists, notices: ['Nothing is watching the vault: an edit made elsewhere will not show until this page is reopened.'] }
  }
  return { exists, notices: [] }
}

/**
 * Starts the plugins the config enables (spec §7).
 *
 * A plugin that will not start stops nothing else: the app is a planner
 * first, and a plugin host only where that costs the planner nothing.
 *
 * @param {import('./core/plugins.js').Folder[]} folders  every plugin on disk
 * @param {Map<string, import('./core/config.js').PluginConfig>} configured
 * @returns {Promise<string[]>} notices
 */
export async function startPlugins(folders, configured) {
  const { start, notices } = plan(folders, configured)
  const failures = []
  for (const plugin of start) {
    try {
      await ipc.startPlugin(plugin.name, plugin.entry, plugin.slots, plugin.capabilities)
    } catch (error) {
      failures.push(`Could not start ${plugin.name}: ${message(error)}`)
    }
  }
  return [...notices, ...failures]
}

/**
 * Registers the shortcut that opens quick add from anywhere.
 *
 * A shortcut the system will not give us is worth saying out loud: the
 * alternative is a hotkey that silently does nothing.
 *
 * @param {string} accelerator
 * @returns {Promise<string[]>} notices
 */
export async function registerHotkey(accelerator) {
  try {
    await ipc.setHotkey(accelerator)
    return []
  } catch (error) {
    return [`Could not register ${accelerator}: ${message(error)}`]
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param {string} id
 * @returns {HTMLStyleElement}
 */
function styleElement(id) {
  const existing = document.querySelector(`#${id}`)
  if (existing instanceof HTMLStyleElement) return existing
  const created = document.createElement('style')
  created.id = id
  document.head.append(created)
  return created
}
