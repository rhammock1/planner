// @ts-check

/**
 * The shell: windows, the menu bar item, the hotkey, alarms, themes and the
 * plugin host.
 *
 * Everything here is something only the operating system can do. None of it
 * touches the vault - that is `vault.js` - and none of it decides anything
 * about what a planner page means.
 */

import { getHost } from './host.js'

/** @typedef {import('./host.js').Alarm} Alarm */

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
 * Replaces the whole set of alarms held by the shell (spec §5.9).
 *
 * Complete every time, never incremental: what the day says is what is
 * scheduled. Rust holds the timers because a hidden webview's are throttled.
 *
 * @param {Alarm[]} list
 * @returns {Promise<void>}
 */
export async function setNotifications(list) {
  return (await getHost()).setNotifications(list)
}

/**
 * Fires when the shell wants the schedule worked out again - every quarter of
 * an hour, and after anything rings.
 *
 * This is how midnight is noticed. Nothing else would: today's alarms all fall
 * into the past and tomorrow's have never been sent, and a timer in a hidden
 * webview cannot be trusted to notice the difference.
 *
 * @param {() => void} handler
 * @returns {Promise<void>}
 */
export async function onScheduleRefresh(handler) {
  await (await getHost()).onScheduleRefresh(handler)
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
 * Starts a plugin in its own webview with the slots and capabilities it was
 * granted.
 *
 * Only the app's own windows can reach this command; a plugin is held to
 * `plugin_message` by the gate in Rust, so none can grant itself anything.
 *
 * @param {string} name
 * @param {string} entry
 * @param {string[]} slots
 * @param {string[]} capabilities
 * @param {string[]} open
 * @param {Record<string, unknown>} settings
 * @returns {Promise<void>}
 */
export async function startPlugin(name, entry, slots, capabilities, open, settings) {
  return (await getHost()).startPlugin(name, entry, slots, capabilities, open, settings)
}

/**
 * Stops a plugin and closes its webview.
 *
 * Does not resolve until the webview is gone, so a caller may start a plugin
 * under the same name the moment this settles (spec §1.2).
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function stopPlugin(name) {
  return (await getHost()).stopPlugin(name)
}

/**
 * Asks every plugin granted this slot, all at once.
 *
 * Slow by nature - it waits on somebody else's code - so nothing renders
 * behind it. The page is drawn without the answers and again when they
 * arrive, or never again if they do not.
 *
 * @param {string} slot
 * @param {import('./host.js').Now} now
 * @param {Record<string, unknown>} params
 * @returns {Promise<import('./host.js').Answers>}
 */
export async function askPlugins(slot, now, params) {
  return (await getHost()).askPlugins(slot, now, params)
}

/**
 * What each plugin this session has started is doing, and why it stopped.
 *
 * @returns {Promise<import('./host.js').PluginState[]>}
 */
export async function pluginStates() {
  return (await getHost()).pluginStates()
}

/**
 * Opens a URL in the system browser, if the config approved it.
 *
 * The app's own window asks; the plugin whose badge carried the URL is not
 * consulted and does not run again to do it. Refused is not shown as a
 * strike against the plugin - approval may have changed since the badge was
 * drawn (spec §6).
 *
 * @param {string} plugin
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function openUrl(plugin, url) {
  return (await getHost()).openUrl(plugin, url)
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
