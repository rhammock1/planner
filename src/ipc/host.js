// @ts-check

/**
 * The seam itself: what the Rust side must provide, and who provides it.
 *
 * Without a Tauri host - opening `src/index.html` in a plain browser - the
 * calls are served by a sample vault instead, so the frontend can be developed
 * and looked at before the shell exists. The seam is exactly the same either
 * way; only the host changes.
 */

/** @typedef {{page: string, text: string}} PageFile */

/** One file beside a day, as a listing names it. @typedef {{date: string, suffix: string, title: string}} Sidecar */

/**
 * What the Rust side must provide. The command names are the contract.
 *
 * @typedef {object} Host
 * @property {() => Promise<{text: string, home: string}>} readConfig
 * @property {(text: string) => Promise<void>} writeConfig
 * @property {() => Promise<string|null>} chooseVault
 * @property {(path: string) => Promise<VaultStatus>} setVault
 * @property {(accelerator: string) => Promise<void>} setHotkey
 * @property {() => Promise<void>} closeQuickAdd
 * @property {(pinned: boolean) => Promise<void>} setPinned
 * @property {(text: string|null) => Promise<void>} setBadge
 * @property {(list: Alarm[]) => Promise<void>} setNotifications
 * @property {(handler: () => void) => void|Promise<void>} onScheduleRefresh
 * @property {() => Promise<void>} closePopover
 * @property {() => Promise<void>} popoverReady
 * @property {(view: string) => Promise<void>} openSpread
 * @property {() => Promise<string|null>} spreadView
 * @property {(handler: (view: string) => void) => void|Promise<void>} onSpreadView
 * @property {(name: string) => Promise<{toml: string, css: string}>} readTheme
 * @property {() => Promise<PageFile[]>} readVault
 * @property {(page: string) => Promise<string|null>} readPage
 * @property {(page: string) => Promise<string|null>} pagePath
 * @property {(path: string, editor: string) => Promise<void>} openInEditor
 * @property {(page: string, text: string) => Promise<void>} writePage
 * @property {(handler: (page: string) => void) => void|Promise<void>} onVaultChanged
 * @property {(date: string, suffix: string) => Promise<string|null>} readSidecar
 * @property {(from: string, to: string) => Promise<Sidecar[]>} listSidecars
 * @property {(date: string, suffix: string, text: string) => Promise<void>} writeSidecar
 * @property {(date: string, suffix: string) => Promise<void>} deleteSidecar
 * @property {(handler: (change: {date: string, suffix: string}) => void) => void|Promise<void>} onSidecarChanged
 * @property {(path: string) => Promise<string|null>} readFile
 * @property {(path: string, text: string) => Promise<void>} writeFile
 * @property {() => Promise<void>} closeFile
 * @property {(handler: (path: string) => void) => void|Promise<void>} onFileChanged
 * @property {(path: string) => Promise<void>} openSpreadFile
 * @property {() => Promise<string|null>} spreadFile
 * @property {(handler: (path: string) => void) => void|Promise<void>} onSpreadFile
 * @property {() => Promise<{name: string, manifest: string}[]>} listPlugins
 * @property {(grant: import('../core/plugins.js').Grant) => Promise<void>} startPlugin
 * @property {(name: string) => Promise<void>} stopPlugin
 * @property {(slot: string, now: Now, params: Record<string, unknown>) => Promise<Answers>} askPlugins
 * @property {() => Promise<PluginState[]>} pluginStates
 * @property {(handler: () => void) => void|Promise<void>} onPopoverShown
 * @property {(plugin: string, url: string) => Promise<void>} openUrl
 * @property {(url: string) => Promise<void>} openLink
 */

/**
 * Whether the vault is there, and whether edits made elsewhere will show up.
 *
 * `events` is the filesystem telling us, `polling` is asking every couple of
 * seconds, `none` is neither working (spec §8).
 *
 * @typedef {{exists: boolean, watching: 'events'|'polling'|'none'}} VaultStatus
 */

/**
 * One line, and the moment it is owed at (spec §5.9).
 *
 * @typedef {{at: number, time: string, text: string}} Alarm
 */

/**
 * The day and the time a question was asked, as every question carries it.
 *
 * @typedef {{date: string, time: string}} Now
 */

/**
 * What a plugin is doing, from the session rather than from either file.
 *
 * @typedef {{name: string, running: boolean, disabled: boolean, reason: string|null}} PluginState
 */

/**
 * What each plugin said, and anything that went wrong asking.
 *
 * `value` is not this app's data and has not been checked: whatever a plugin
 * returned, in whatever shape it returned it. It is given a shape on the way
 * to the page, not here.
 *
 * @typedef {{answers: {plugin: string, value: unknown}[], notices: string[]}} Answers
 */

/** @type {Promise<Host>|null} */
let host = null

/** @returns {Promise<Host>} */
export function getHost() {
  if (host !== null) return host
  host = hasTauriHost()
    ? Promise.resolve(tauriHost())
    : import('../dev/sampleVault.js').then((module) => module.sampleHost())
  return host
}

/** @returns {boolean} */
export function hasTauriHost() {
  return '__TAURI__' in window
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
    writeConfig: (text) => invoke('write_config', { text }),
    chooseVault: () => invoke('choose_vault'),
    setVault: (path) => invoke('set_vault', { path }),
    setHotkey: (accelerator) => invoke('set_hotkey', { accelerator }),
    closeQuickAdd: () => invoke('close_quick_add'),
    setPinned: (pinned) => invoke('set_pinned', { pinned }),
    setBadge: (text) => invoke('set_badge', { text }),
    setNotifications: (list) => invoke('set_notifications', { list }),
    onScheduleRefresh: (handler) => tauri.event.listen('schedule:refresh', () => handler()),
    closePopover: () => invoke('close_popover'),
    popoverReady: () => invoke('popover_ready'),
    openSpread: (view) => invoke('open_spread', { view }),
    spreadView: () => invoke('spread_view'),
    listPlugins: () => invoke('list_plugins'),
    startPlugin: (grant) => invoke('start_plugin', { grant }),
    stopPlugin: (name) => invoke('stop_plugin', { name }),
    askPlugins: (slot, now, params) => invoke('ask_plugins', { slot, now, params }),
    pluginStates: () => invoke('plugin_states'),
    openUrl: (plugin, url) => invoke('open_url', { plugin, url }),
    openLink: (url) => invoke('open_link', { url }),
    onPopoverShown: (handler) => tauri.event.listen('popover:shown', () => handler()),
    readTheme: (name) => invoke('read_theme', { name }),
    readVault: () => invoke('read_vault'),
    readPage: (page) => invoke('read_page', { page }),
    pagePath: (page) => invoke('page_path', { page }),
    openInEditor: (path, editor) => invoke('open_in_editor', { path, editor }),
    writePage: (page, text) => invoke('write_page', { page, text }),
    // Awaited, and allowed to throw. A refused listener is the difference
    // between an app that saves your edits and one that only appears to: the
    // write lands on disk and nothing on screen ever changes.
    onVaultChanged: (handler) =>
      tauri.event.listen('vault:changed', (/** @type {any} */ event) => {
        handler(String(event.payload?.page ?? ''))
      }),
    readSidecar: (date, suffix) => invoke('read_sidecar', { date, suffix }),
    listSidecars: (from, to) => invoke('list_sidecars', { from, to }),
    writeSidecar: (date, suffix, text) => invoke('write_sidecar', { date, suffix, text }),
    deleteSidecar: (date, suffix) => invoke('delete_sidecar', { date, suffix }),
    // Same shape as `onVaultChanged`: unwrapped and coerced here rather than
    // handed the raw payload, so a malformed event cannot hand the rest of
    // the app anything but a pair.
    onSidecarChanged: (handler) =>
      tauri.event.listen('sidecar:changed', (/** @type {any} */ event) => {
        handler({
          date: String(event.payload?.date ?? ''),
          suffix: String(event.payload?.suffix ?? ''),
        })
      }),
    // Also awaited and allowed to throw: a window that cannot hear this is a
    // window whose tabs quietly stop switching it.
    onSpreadView: (handler) =>
      tauri.event.listen('spread:view', (/** @type {any} */ event) => {
        handler(String(event.payload ?? ''))
      }),
    readFile: (path) => invoke('read_file', { path }),
    writeFile: (path, text) => invoke('write_file', { path, text }),
    closeFile: () => invoke('close_file'),
    // Same shape as `onSidecarChanged`: unwrapped and coerced here rather
    // than handed the raw payload, so a malformed event cannot hand the rest
    // of the app anything but a string.
    onFileChanged: (handler) =>
      tauri.event.listen('file:changed', (/** @type {any} */ event) => {
        handler(String(event.payload?.path ?? ''))
      }),
    openSpreadFile: (path) => invoke('open_spread_file', { path }),
    spreadFile: () => invoke('spread_file'),
    onSpreadFile: (handler) =>
      tauri.event.listen('spread:file', (/** @type {any} */ event) => {
        handler(String(event.payload ?? ''))
      }),
  }
}
