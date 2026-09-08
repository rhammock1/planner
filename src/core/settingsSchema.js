// @ts-check

/**
 * A plugin's own settings schema, as its manifest declares it (spec §2.2).
 *
 * Its own file because this is what a plugin says about *its own* config
 * rather than about what it reaches - it is not a permission, and the pane
 * draws it with the same rows the app's own settings use.
 *
 * A key that will not do is dropped with a line rather than refusing the whole
 * plugin: the other settings still work, and so does everything the plugin
 * does that does not read the bad one.
 */

import { isBareKey } from './toml.js'

/**
 * @typedef {object} SettingsField
 * @property {string} key  the name in `[plugins.<name>.settings]`
 * @property {string} label  what the pane shows
 * @property {'text'|'count'|'switch'} kind
 * @property {string|null} hint  a placeholder, for a value whose absence means something
 * @property {string|number|boolean|null} fallback  the manifest's default, if it has one
 */

/** The kinds the pane can draw. `path` is not offered: its picker is the
 *  vault's, and no plugin in this design needs a folder. */
const KINDS = ['text', 'count', 'switch']

/**
 * @param {unknown} raw  the `settings` table
 * @param {string[]} notices
 * @returns {SettingsField[]}
 */
export function readSettings(raw, notices) {
  if (raw === undefined) return []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    notices.push('manifest.toml has a settings key that is not a table')
    return []
  }

  /** @type {SettingsField[]} */
  const fields = []
  for (const [key, declared] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    if (!isBareKey(key)) {
      notices.push(`manifest.toml declares a setting called ${key}, which cannot be a config.toml key`)
      continue
    }
    if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
      notices.push(`manifest.toml declares ${key} as something other than a table`)
      continue
    }

    const one = /** @type {Record<string, unknown>} */ (declared)
    const label = one['label']
    if (typeof label !== 'string' || label === '') {
      notices.push(`manifest.toml gives the setting ${key} no label`)
      continue
    }

    const kind = one['kind']
    if (typeof kind !== 'string' || !KINDS.includes(kind)) {
      notices.push(`manifest.toml gives the setting ${key} a kind this pane cannot draw: ${String(kind)}`)
      continue
    }

    const fallback = one['default']
    if (fallback !== undefined && !matches(fallback, kind)) {
      notices.push(`manifest.toml gives the setting ${key} a default that is not a ${kind}`)
      continue
    }

    const hint = one['hint']
    fields.push({
      key,
      label,
      kind: /** @type {'text'|'count'|'switch'} */ (kind),
      hint: typeof hint === 'string' ? hint : null,
      fallback: fallback === undefined ? null : /** @type {string|number|boolean} */ (fallback),
    })
  }
  return fields
}

/**
 * @param {unknown} value
 * @param {string} kind
 * @returns {boolean}
 */
function matches(value, kind) {
  if (kind === 'text') return typeof value === 'string'
  if (kind === 'switch') return typeof value === 'boolean'
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
