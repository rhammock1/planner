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
 * A file beside a day (spec §4.1). Null when it is not there - which is how a
 * block tells "no note yet" from "an empty note".
 *
 * @param {string} date  `YYYY-MM-DD`
 * @param {string} suffix
 * @returns {Promise<string|null>}
 */
export async function readSidecar(date, suffix) {
  return (await getHost()).readSidecar(date, suffix)
}

/**
 * Every sidecar between two dates, inclusive, in date then suffix order.
 *
 * A range rather than a day, because a search provider looking at four months
 * cannot make a hundred and twenty calls inside two seconds (spec §4.1).
 *
 * @param {string} from
 * @param {string} to
 * @returns {Promise<import('./host.js').Sidecar[]>}
 */
export async function listSidecars(from, to) {
  return (await getHost()).listSidecars(from, to)
}

/**
 * Writes a sidecar whole.
 *
 * The app holds the pen. A plugin names one of these and never writes one, so
 * everything that reaches here came from a block somebody typed into.
 *
 * @param {string} date
 * @param {string} suffix
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function writeSidecar(date, suffix, text) {
  return (await getHost()).writeSidecar(date, suffix, text)
}

/**
 * Deletes a sidecar by moving it into `.trash/` (spec §2.4).
 *
 * The app's own gesture. A plugin names a sidecar and never writes one, and it
 * does not delete one either - there is no capability for this and no
 * manifest declares it.
 *
 * @param {string} date
 * @param {string} suffix
 * @returns {Promise<void>}
 */
export async function deleteSidecar(date, suffix) {
  return (await getHost()).deleteSidecar(date, suffix)
}

/**
 * Fires when a sidecar changes on disk, whoever changed it.
 *
 * @param {(change: {date: string, suffix: string}) => void} handler
 * @returns {Promise<void>}
 */
export async function onSidecarChanged(handler) {
  await (await getHost()).onSidecarChanged(handler)
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
