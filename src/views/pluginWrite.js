// @ts-check

/**
 * One writeback for a plugin's `config.toml` section.
 *
 * Every tick in the pane writes the *whole* section, because `tomlEdit` writes
 * keys rather than diffs - so each one has to carry the five approvals it is
 * not changing. Written out at each call site, that was six chances to drop a
 * field and silently erase somebody's approvals; here it is one.
 *
 * The `settings` it writes are `plugin.held` - what the person actually set -
 * and never `plugin.settings`, which is the settled map with the manifest's
 * defaults filled in. Writing those back would turn the author's default into
 * the person's value on the first tick, and `personSet` could never tell them
 * apart again (spec §3.2).
 */

/** @typedef {import('../core/installed.js').Installed} Installed */
/** @typedef {import('../core/config.js').PluginConfig} PluginConfig */
/** @typedef {import('./settingsPanel.js').SettingsHandlers} SettingsHandlers */

/**
 * @param {Installed} plugin
 * @param {SettingsHandlers} handlers
 * @param {Partial<PluginConfig>} change  the one field this tick decides
 * @returns {void}
 */
export function writeBack(plugin, handlers, change) {
  handlers.onPlugin(plugin.name, {
    enabled: plugin.enabled,
    approvedSlots: plugin.approvedSlots,
    approvedCapabilities: plugin.approved,
    approvedOpen: plugin.approvedOpen,
    approvedRun: plugin.approvedRun,
    settings: plugin.held,
    ...change,
  })
}
