// @ts-check

/**
 * The only module that talks to Rust (spec §11.6).
 *
 * Every mutation in the app goes: view -> core computes a new Document ->
 * here -> Rust writes the file atomically -> the watcher fires -> the app
 * re-reads that one page. Nothing in the UI writes a file, and nothing keeps
 * an in-memory copy that can drift from disk (spec §4.1).
 *
 * Without a Tauri host - opening `src/index.html` in a plain browser - the
 * calls below are served by a sample vault instead, so the frontend can be
 * developed and looked at before the shell exists. The seam is exactly the
 * same either way; only the host changes.
 */

/** @typedef {{page: string, text: string}} PageFile */

/**
 * What the Rust side must provide. The command names are the contract.
 *
 * @typedef {object} Host
 * @property {() => Promise<string>} readConfig
 * @property {(name: string) => Promise<{toml: string, css: string}>} readTheme
 * @property {() => Promise<PageFile[]>} readVault
 * @property {(page: string) => Promise<string|null>} readPage
 * @property {(page: string, text: string) => Promise<void>} writePage
 * @property {(handler: (page: string) => void) => void} onVaultChanged
 */

/** @type {Promise<Host>|null} */
let host = null

/** @returns {Promise<Host>} */
function getHost() {
  if (host !== null) return host
  host = hasTauriHost()
    ? Promise.resolve(tauriHost())
    : import('./dev/sampleVault.js').then((module) => module.sampleHost())
  return host
}

/** @returns {boolean} */
export function hasTauriHost() {
  return '__TAURI_INTERNALS__' in window
}

/** @returns {Promise<string>} the contents of ~/.planner/config.toml */
export async function readConfig() {
  return (await getHost()).readConfig()
}

/**
 * @param {string} name
 * @returns {Promise<{toml: string, css: string}>} empty strings when absent
 */
export async function readTheme(name) {
  return (await getHost()).readTheme(name)
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
  (await getHost()).onVaultChanged(handler)
}

/**
 * @returns {Host}
 */
function tauriHost() {
  /** @param {string} command @param {Record<string, unknown>} [args] */
  const invoke = (command, args) => {
    /** @type {any} */
    const internals = (/** @type {any} */ (window)).__TAURI_INTERNALS__
    return internals.invoke(command, args ?? {})
  }

  return {
    readConfig: () => invoke('read_config'),
    readTheme: (name) => invoke('read_theme', { name }),
    readVault: () => invoke('read_vault'),
    readPage: (page) => invoke('read_page', { page }),
    writePage: (page, text) => invoke('write_page', { page, text }),
    onVaultChanged: (handler) => {
      /** @type {any} */
      const internals = (/** @type {any} */ (window)).__TAURI_INTERNALS__
      internals.event.listen('vault:changed', (/** @type {any} */ event) => {
        handler(String(event.payload?.page ?? ''))
      })
    },
  }
}
