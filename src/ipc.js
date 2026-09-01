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
 * @property {() => Promise<{text: string, home: string}>} readConfig
 * @property {(path: string) => Promise<{exists: boolean}>} setVault
 * @property {(accelerator: string) => Promise<void>} setHotkey
 * @property {() => Promise<void>} closeQuickAdd
 * @property {(pinned: boolean) => Promise<void>} setPinned
 * @property {(text: string|null) => Promise<void>} setBadge
 * @property {() => Promise<void>} closePopover
 * @property {(view: string) => Promise<void>} openSpread
 * @property {() => Promise<string|null>} spreadView
 * @property {(handler: (view: string) => void) => void|Promise<void>} onSpreadView
 * @property {(name: string) => Promise<{toml: string, css: string}>} readTheme
 * @property {() => Promise<PageFile[]>} readVault
 * @property {(page: string) => Promise<string|null>} readPage
 * @property {(page: string, text: string) => Promise<void>} writePage
 * @property {(handler: (page: string) => void) => void|Promise<void>} onVaultChanged
 * @property {() => Promise<{name: string, manifest: string}[]>} listPlugins
 * @property {(name: string, entry: string, capabilities: string[]) => Promise<void>} startPlugin
 * @property {(from: string, to: string) => Promise<Contributions>} contribute
 * @property {(handler: () => void) => void|Promise<void>} onPopoverShown
 */

/**
 * What the plugins had to add, and anything that went wrong asking.
 *
 * `items` is not this app's data and has not been checked: whatever a plugin
 * returned, in whatever shape it returned it. It is given a shape on the way
 * to the page, not here.
 *
 * @typedef {{items: unknown[], notices: string[]}} Contributions
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
  return '__TAURI__' in window
}

/**
 * @returns {Promise<{text: string, home: string}>} the contents of
 *   ~/.planner/config.toml, and the home directory to resolve `~` against
 */
export async function readConfig() {
  return (await getHost()).readConfig()
}

/**
 * Tells the shell where the vault is, and starts the watcher on it. Rust does
 * not read the config: there is one TOML reader in this project and it is the
 * one the settings pane uses.
 *
 * @param {string} path  absolute, with any `~` already resolved
 * @returns {Promise<{exists: boolean}>}
 */
export async function setVault(path) {
  return (await getHost()).setVault(path)
}

/**
 * @param {string} name
 * @returns {Promise<{toml: string, css: string}>} empty strings when absent
 */
export async function readTheme(name) {
  return (await getHost()).readTheme(name)
}

/**
 * Registers the shortcut that opens quick add, replacing any earlier one.
 *
 * @param {string} accelerator  e.g. `Alt+Space`
 * @returns {Promise<void>}
 */
export async function setHotkey(accelerator) {
  return (await getHost()).setHotkey(accelerator)
}

/**
 * Puts the quick-add window away once it has done its job.
 *
 * @returns {Promise<void>}
 */
export async function closeQuickAdd() {
  return (await getHost()).closeQuickAdd()
}

/**
 * Pins the popover open, or lets it go back to closing when clicked away.
 *
 * @param {boolean} pinned
 * @returns {Promise<void>}
 */
export async function setPinned(pinned) {
  return (await getHost()).setPinned(pinned)
}

/**
 * Labels the menu bar icon with what today still holds (spec §5.8).
 *
 * Null takes the label off, which is what a day with nothing left looks like.
 *
 * @param {string|null} text
 * @returns {Promise<void>}
 */
export async function setBadge(text) {
  return (await getHost()).setBadge(text)
}

/**
 * @returns {Promise<void>}
 */
export async function closePopover() {
  return (await getHost()).closePopover()
}

/**
 * Opens the detached window on one of its views, or brings it forward and
 * switches to that view (spec §5.6).
 *
 * @param {string} view
 * @returns {Promise<void>}
 */
export async function openSpread(view) {
  return (await getHost()).openSpread(view)
}

/**
 * The view the detached window was last asked for, read as it starts.
 *
 * @returns {Promise<string|null>} null when nothing has asked yet
 */
export async function spreadView() {
  return (await getHost()).spreadView()
}

/**
 * Fires when the footer asks the detached window for a different view.
 *
 * @param {(view: string) => void} handler
 * @returns {Promise<void>}
 */
export async function onSpreadView(handler) {
  await (await getHost()).onSpreadView(handler)
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
  await (await getHost()).onVaultChanged(handler)
}

/**
 * Every plugin folder in `~/.planner/plugins`, installed or not, with its
 * manifest as text. Parsing it is core's job (`core/plugins.js`); there is
 * one TOML reader in this project and Rust is not it.
 *
 * @returns {Promise<{name: string, manifest: string}[]>}
 */
export async function listPlugins() {
  return (await getHost()).listPlugins()
}

/**
 * Starts a plugin in its own webview with the capabilities it was granted.
 *
 * Only the app's own windows can reach this command; a plugin is held to
 * `plugin_message` by the gate in Rust, so none can grant itself anything.
 *
 * @param {string} name
 * @param {string} entry
 * @param {string[]} capabilities
 * @returns {Promise<void>}
 */
export async function startPlugin(name, entry, capabilities) {
  return (await getHost()).startPlugin(name, entry, capabilities)
}

/**
 * Asks every running plugin what it has for these days.
 *
 * Slow by nature - it waits on somebody else's code - so nothing renders
 * behind it. The page is drawn without contributions and again when they
 * arrive, or never again if they do not.
 *
 * @param {string} from `YYYY-MM-DD`
 * @param {string} to
 * @returns {Promise<Contributions>}
 */
export async function contribute(from, to) {
  return (await getHost()).contribute(from, to)
}

/**
 * Fires when the menu bar icon opens the popover.
 *
 * Opening it is asking what today looks like, which makes it the moment to
 * ask the plugins again rather than showing what they said at launch.
 *
 * @param {() => void} handler
 * @returns {Promise<void>}
 */
export async function onPopoverShown(handler) {
  await (await getHost()).onPopoverShown(handler)
}

/**
 * @returns {Host}
 */
function tauriHost() {
  /** @type {any} */
  const tauri = (/** @type {any} */ (window)).__TAURI__

  /** @param {string} command @param {Record<string, unknown>} [args] */
  const invoke = (command, args) => tauri.core.invoke(command, args ?? {})

  return {
    readConfig: () => invoke('read_config'),
    setVault: (path) => invoke('set_vault', { path }),
    setHotkey: (accelerator) => invoke('set_hotkey', { accelerator }),
    closeQuickAdd: () => invoke('close_quick_add'),
    setPinned: (pinned) => invoke('set_pinned', { pinned }),
    setBadge: (text) => invoke('set_badge', { text }),
    closePopover: () => invoke('close_popover'),
    openSpread: (view) => invoke('open_spread', { view }),
    spreadView: () => invoke('spread_view'),
    listPlugins: () => invoke('list_plugins'),
    startPlugin: (name, entry, capabilities) =>
      invoke('start_plugin', { name, entry, capabilities }),
    contribute: (from, to) => invoke('contribute', { from, to }),
    onPopoverShown: (handler) => tauri.event.listen('popover:shown', () => handler()),
    readTheme: (name) => invoke('read_theme', { name }),
    readVault: () => invoke('read_vault'),
    readPage: (page) => invoke('read_page', { page }),
    writePage: (page, text) => invoke('write_page', { page, text }),
    // Awaited, and allowed to throw. A refused listener is the difference
    // between an app that saves your edits and one that only appears to: the
    // write lands on disk and nothing on screen ever changes.
    onVaultChanged: (handler) =>
      tauri.event.listen('vault:changed', (/** @type {any} */ event) => {
        handler(String(event.payload?.page ?? ''))
      }),
    // Also awaited and allowed to throw: a window that cannot hear this is a
    // window whose tabs quietly stop switching it.
    onSpreadView: (handler) =>
      tauri.event.listen('spread:view', (/** @type {any} */ event) => {
        handler(String(event.payload ?? ''))
      }),
  }
}
