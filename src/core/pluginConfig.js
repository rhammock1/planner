// @ts-check

/**
 * The plugin half of `config.toml` - the `[plugins.<name>]` sections, each
 * keyed by a folder name the user put on disk rather than a name this app
 * chose (spec §3.6, §7).
 *
 * Split out of `config.js` because this half grows a settings table of its
 * own per plugin, on top of the switch and the three approval lists every
 * plugin already carries.
 */

import { updateToml } from './tomlEdit.js'
import { isPluginName } from './plugins.js'

/** @typedef {import('./toml.js').TomlValue} TomlValue */
/** @typedef {import('./toml.js').TomlTable} TomlTable */
/** @typedef {import('./config.js').PluginConfig} PluginConfig */

/**
 * Switches a plugin on or off, and says what it may reach (spec §7).
 *
 * Its own function because a plugin's settings live in a table of their own,
 * named after a folder the user put there - which is not something the
 * top-level config fields can describe.
 *
 * @param {string} text
 * @param {string} name  the plugin's folder name
 * @param {PluginConfig} settings
 * @returns {string}
 */
export function updatePlugin(text, name, settings) {
  // The one place a plugin's own table header is written. A name that could
  // not be a folder name could open somebody else's table, and the pane
  // cannot be trusted not to offer the switch (spec §0.2).
  if (!isPluginName(name)) return text

  return updateToml(text, [
    { path: ['plugins', name, 'enabled'], value: settings.enabled },
    { path: ['plugins', name, 'approved_slots'], value: settings.approvedSlots },
    { path: ['plugins', name, 'approved_capabilities'], value: settings.approvedCapabilities },
    { path: ['plugins', name, 'approved_open'], value: settings.approvedOpen },
    ...[...settings.approvedRun].map(([command, line]) => ({
      path: ['plugins', name, 'run', command],
      value: line,
    })),
    ...[...settings.settings].map(([key, value]) => ({
      path: ['plugins', name, 'settings', key],
      value,
    })),
  ])
}

/**
 * Plugin sections are keyed by a name the user chose, so they live in a Map:
 * a plain object would let a plugin folder called `__proto__` write somewhere
 * it has no business being.
 *
 * @param {TomlTable} table
 * @param {string[]} notices
 * @returns {Map<string, PluginConfig>}
 */
export function readPlugins(table, notices) {
  /** @type {Map<string, PluginConfig>} */
  const plugins = new Map()

  const section = table['plugins']
  if (section === undefined) return plugins
  if (typeof section !== 'object' || Array.isArray(section)) {
    notices.push('config.toml: plugins is not a table of plugin settings; ignoring it')
    return plugins
  }

  for (const [name, entry] of Object.entries(section)) {
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      notices.push(`config.toml: plugins.${name} is not a table; ignoring it`)
      continue
    }
    const rawEnabled = entry['enabled'] ?? false
    const enabled = typeof rawEnabled === 'boolean' ? rawEnabled : null
    if (enabled === null) notices.push(`config.toml: plugins.${name}.enabled is not a boolean; treating it as disabled`)
    plugins.set(name, {
      enabled: enabled === null ? false : enabled,
      approvedSlots: readNames(name, 'approved_slots', entry['approved_slots'], notices),
      approvedCapabilities:
        readNames(name, 'approved_capabilities', entry['approved_capabilities'], notices),
      approvedOpen: readNames(name, 'approved_open', entry['approved_open'], notices),
      approvedRun: readLines(entry['run']),
      settings: readSettings(entry['settings']),
    })
  }
  return plugins
}

/**
 * A plugin's own settings, exactly as the file holds them.
 *
 * Not validated here: this module knows nothing about any plugin's schema.
 * `plan()` checks them against the manifest, which is where both halves are
 * in the same room (spec §2.2).
 *
 * A Map, for the same reason the plugins themselves are one: the keys are
 * names somebody else chose, and a plain object would let a setting called
 * `__proto__` write somewhere it has no business being.
 *
 * @param {TomlValue|TomlTable|undefined} raw
 * @returns {Map<string, TomlValue>}
 */
function readSettings(raw) {
  /** @type {Map<string, TomlValue>} */
  const held = new Map()
  if (typeof raw !== 'object' || raw === undefined || Array.isArray(raw)) return held
  for (const [key, value] of Object.entries(raw)) {
    // A nested table is not a setting: the schema has three kinds and none of
    // them is a table.
    if (typeof value === 'object' && !Array.isArray(value)) continue
    held.set(key, value)
  }
  return held
}

/**
 * The commands a plugin has been approved to run, as the lines that were
 * approved (spec §1.6).
 *
 * Not checked against anything here: this module knows nothing about any
 * manifest. `plan()` compares each line with what the manifest now renders
 * to, which is where both halves are in the same room.
 *
 * A Map, for the same reason the settings are one: the keys are names
 * somebody else chose.
 *
 * @param {TomlValue|TomlTable|undefined} raw
 * @returns {Map<string, string>}
 */
function readLines(raw) {
  /** @type {Map<string, string>} */
  const held = new Map()
  if (typeof raw !== 'object' || raw === undefined || Array.isArray(raw)) return held
  for (const [key, value] of Object.entries(raw)) {
    // Only a line. A number or a table under here is not an approval of
    // anything, and treating it as one would be inventing consent.
    if (typeof value !== 'string') continue
    held.set(key, value)
  }
  return held
}

/**
 * @param {string} name
 * @param {string} key
 * @param {TomlValue|TomlTable|undefined} raw
 * @param {string[]} notices
 * @returns {string[]}
 */
function readNames(name, key, raw, notices) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    notices.push(`config.toml: plugins.${name}.${key} is not a list; treating it as empty`)
    return []
  }
  return [...raw]
}
