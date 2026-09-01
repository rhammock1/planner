// @ts-check

/**
 * The vault: the config that says where it is, the pages inside it, and the
 * one call that writes one.
 *
 * Every mutation in the app goes: view -> core computes a new Document ->
 * here -> Rust writes the file atomically -> the watcher fires -> the app
 * re-reads that one page. Nothing in the UI writes a file, and nothing keeps
 * an in-memory copy that can drift from disk (spec §4.1).
 */

import { getHost } from './host.js'

/** @typedef {import('./host.js').PageFile} PageFile */
/** @typedef {import('./host.js').VaultStatus} VaultStatus */

/**
 * @returns {Promise<{text: string, home: string}>} the contents of
 *   ~/.planner/config.toml, and the home directory to resolve `~` against
 */
export async function readConfig() {
  return (await getHost()).readConfig()
}

/**
 * Writes `config.toml` whole.
 *
 * The text is edited by `core/tomlEdit.js` before it gets here, so comments,
 * alignment and keys this version does not know about all survive (spec §3.6).
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function writeConfig(text) {
  return (await getHost()).writeConfig(text)
}

/**
 * Asks the user for a folder to keep the vault in (spec §8).
 *
 * @returns {Promise<string|null>} null if the dialog was dismissed
 */
export async function chooseVault() {
  return (await getHost()).chooseVault()
}

/**
 * Tells the shell where the vault is, and starts the watcher on it. Rust does
 * not read the config: there is one TOML reader in this project and it is the
 * one the settings pane uses.
 *
 * @param {string} path  absolute, with any `~` already resolved
 * @returns {Promise<VaultStatus>}
 */
export async function setVault(path) {
  return (await getHost()).setVault(path)
}

/** @returns {Promise<PageFile[]>} every page in the vault */
export async function readVault() {
  return (await getHost()).readVault()
}

/**
 * @param {string} page
 * @returns {Promise<string|null>} null when the file does not exist
 */
export async function readPage(page) {
  return (await getHost()).readPage(page)
}

/**
 * Where a page's file is, for handing to an editor.
 *
 * @param {string} page
 * @returns {Promise<string|null>} null when no vault is open
 */
export async function pagePath(page) {
  return (await getHost()).pagePath(page)
}

/**
 * @param {string} page
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function writePage(page, text) {
  return (await getHost()).writePage(page, text)
}

/**
 * Fires when a page changes on disk, whoever changed it - this app, or nvim.
 *
 * @param {(page: string) => void} handler
 * @returns {Promise<void>}
 */
export async function onVaultChanged(handler) {
  await (await getHost()).onVaultChanged(handler)
}

/**
 * Opens a file in the user's editor (spec §8).
 *
 * The escape hatch: the vault is a folder of Markdown precisely so that
 * anything this app gets wrong about a line can be put right by hand.
 *
 * @param {string} path
 * @param {string} editor  from `config.toml`; empty falls back to $VISUAL,
 *   then $EDITOR, then whatever the system opens a `.md` with
 * @returns {Promise<void>}
 */
export async function openInEditor(path, editor) {
  return (await getHost()).openInEditor(path, editor)
}
