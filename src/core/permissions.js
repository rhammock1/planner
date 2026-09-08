// @ts-check

/**
 * What a manifest's `[permissions]` tables ask for.
 *
 * Its own file because this is the half of a manifest that grows: a capability
 * that carries a list of things it may reach - addresses (spec §2.1), commands
 * (spec §3.2) - brings its own table and its own rules with it, and every one
 * of those rules is about reach rather than about what the plugin is.
 *
 * Nothing here decides anything. It reads what was asked for; `plan()` settles
 * it against what `config.toml` approved.
 */

import { isBareKey } from './toml.js'
import { readPrefix } from './urls.js'

/**
 * @param {unknown} permissions
 * @returns {string[]|string} a string is an error
 */
export function readCapabilities(permissions) {
  if (permissions === undefined) return []
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    return 'manifest.toml has a permissions key that is not a table'
  }

  const wanted = /** @type {Record<string, unknown>} */ (permissions)['capabilities']
  if (wanted === undefined) return []
  if (!Array.isArray(wanted) || wanted.some((one) => typeof one !== 'string')) {
    return 'manifest.toml lists permissions.capabilities as something other than a list of names'
  }
  return /** @type {string[]} */ (wanted)
}

/**
 * The addresses a plugin says it may open.
 *
 * Each is checked here rather than at the click, so the pane shows what was
 * approved and a manifest that asks for something impossible says so once
 * instead of failing silently every time a marker is pressed.
 *
 * An entry of the form `settings.<key>` cannot be checked here at all - this
 * reader has no settings values, only the schema - so it is kept verbatim,
 * with only its key checked against the same rule a settings key obeys.
 * `plan()` resolves it once the config's settings have been settled.
 *
 * @param {unknown} permissions
 * @param {string[]} notices
 * @returns {string[]|string} a string is an error
 */
export function readOpen(permissions, notices) {
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    return []
  }
  const table = /** @type {Record<string, unknown>} */ (permissions)['open']
  if (table === undefined) return []
  if (typeof table !== 'object' || Array.isArray(table)) {
    return 'manifest.toml has a permissions.open key that is not a table'
  }

  const urls = /** @type {Record<string, unknown>} */ (table)['urls']
  if (urls === undefined) return []
  if (!Array.isArray(urls) || urls.some((one) => typeof one !== 'string')) {
    return 'manifest.toml lists permissions.open.urls as something other than a list of addresses'
  }

  /** @type {string[]} */
  const kept = []
  for (const entry of /** @type {string[]} */ (urls)) {
    if (entry.startsWith('settings.')) {
      const key = entry.slice('settings.'.length)
      if (!isBareKey(key)) {
        notices.push(`manifest.toml asks to open ${entry}, whose setting name is not one config.toml could hold`)
        continue
      }
      if (!kept.includes(entry)) kept.push(entry)
      continue
    }
    const read = readPrefix(entry)
    if (read.error !== null) {
      notices.push(`manifest.toml asks to open ${read.error}`)
      continue
    }
    if (!kept.includes(read.prefix)) kept.push(read.prefix)
  }
  return kept
}
