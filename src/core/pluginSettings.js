// @ts-check

/**
 * A plugin's settings, checked against the schema it declared - and the
 * `[permissions.open]` entries that read one of them, since resolving those
 * needs the same settled values.
 *
 * Split out of `plugins.js` because this is where the manifest-is-ceiling
 * rule gets applied a third time (spec §2.2), on top of slots and
 * capabilities, and `plugins.js` had no room left to say so at length.
 */

import { resolvePrefix } from './urls.js'

/** @typedef {import('./settingsSchema.js').SettingsField} SettingsField */
/** @typedef {import('./toml.js').TomlValue} TomlValue */

/**
 * The manifest is the ceiling here too: a key in `config.toml` the manifest
 * never declared is a typo, not a permission, and is not handed over. A value
 * of the wrong kind is dropped with a line and the default used, because a
 * planner that refuses to start over a settings typo is worse than one that
 * starts and says so (spec §8).
 *
 * @param {string} name
 * @param {SettingsField[]} schema
 * @param {Map<string, TomlValue>} held
 * @param {string[]} notices
 * @returns {Map<string, TomlValue>}
 */
export function settled(name, schema, held, notices) {
  /** @type {Map<string, TomlValue>} */
  const settings = new Map()

  for (const field of schema) {
    const value = held.get(field.key)
    if (value !== undefined && kindOf(value) === field.kind) {
      settings.set(field.key, value)
      continue
    }
    if (value !== undefined) {
      notices.push(`config.toml: plugins.${name}.settings.${field.key} is not a ${field.kind}; using the default`)
    }
    // A key with no default and no value is absent from what the plugin
    // sees, rather than present and empty.
    if (field.fallback !== null) settings.set(field.key, field.fallback)
  }
  return settings
}

/**
 * The manifest's own `open` entries, resolved against the settled settings.
 *
 * A literal entry passes through unchanged; a `settings.<key>` entry is
 * resolved here, where the settled values are known. `Installed.open` and
 * `Start.open` (in `plugins.js`) both go through this, so the pane's tick and
 * the address handed to Rust are the same string.
 *
 * @param {string} name
 * @param {string[]} open
 * @param {Map<string, TomlValue>} settings
 * @param {string[]} notices
 * @returns {string[]}
 */
export function resolveOpen(name, open, settings, notices) {
  /** @type {string[]} */
  const kept = []
  for (const entry of open) {
    const read = resolvePrefix(entry, /** @type {Map<string, string|number|boolean>} */ (settings))
    if (read.error !== null) {
      notices.push(`${name}: ${read.error}`)
      continue
    }
    if (!kept.includes(read.prefix)) kept.push(read.prefix)
  }
  return kept
}

/**
 * @param {TomlValue} value
 * @returns {string}
 */
function kindOf(value) {
  if (typeof value === 'string') return 'text'
  if (typeof value === 'boolean') return 'switch'
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return 'count'
  return 'none'
}
