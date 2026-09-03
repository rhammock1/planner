// @ts-check

/**
 * Reading `manifest.toml` — what a plugin declares about itself.
 *
 * The one place this file is understood. It stays inside what `core/toml.js`
 * parses: bare keys, strings, numbers, booleans, single-line arrays of
 * strings, and `[dotted.table]` headers (spec §1.1).
 *
 * There are two kinds of wrong. An `error` is a manifest this app cannot act
 * on at all, and the plugin does not start. A `notice` is a manifest it can
 * act on with a part left out — a slot from a later version of the planner,
 * say — and the plugin runs without that part. Neither is ever guessed at.
 */

import { parseToml } from './toml.js'
import { isSlot } from './slots.js'
import { readPrefix } from './urls.js'

/**
 * @typedef {object} Manifest
 * @property {string} entry  the file the plugin begins at
 * @property {string[]} slots  declared, and offered by this version
 * @property {string[]} unofferedSlots  declared, but not offered by this
 *   version - config.toml approving one of these too is not a second
 *   complaint, since this file already made the first one
 * @property {string[]} capabilities  declared; the config decides the rest
 * @property {string[]} open  addresses this plugin says it may open
 * @property {string|null} error  why it cannot run, when it cannot
 * @property {string[]} notices  what was left out, and why
 * @property {SettingsField[]} settings  the plugin's own settings schema
 */

/**
 * @typedef {object} SettingsField
 * @property {string} key  the name in `[plugins.<name>.settings]`
 * @property {string} label  what the pane shows
 * @property {'text'|'count'|'switch'} kind
 * @property {string|null} hint  a placeholder, for a value whose absence means something
 * @property {string|number|boolean|null} fallback  the manifest's default, if it has one
 */

/** What a settings key may be called, because it becomes a `config.toml` key. */
const IDENTIFIER = /^[A-Za-z0-9_-]+$/

/** The kinds the pane can draw. `path` is not offered: its picker is the
 *  vault's, and no plugin in this design needs a folder. */
const KINDS = ['text', 'count', 'switch']

/**
 * @param {string} text  the contents of manifest.toml
 * @returns {Manifest}
 */
export function readManifest(text) {
  /** @param {string} error @returns {Manifest} */
  const bad = (error) => (
    { entry: '', slots: [], unofferedSlots: [], capabilities: [], open: [], error, notices: [], settings: [] }
  )

  let table
  try {
    table = parseToml(text)
  } catch (error) {
    return bad(`manifest.toml could not be read (${error instanceof Error ? error.message : error})`)
  }

  const entry = table['entry']
  if (typeof entry !== 'string' || entry === '') {
    return bad('manifest.toml does not say which file to start at')
  }
  // A plugin is served out of its own folder and starts at a file inside it.
  // Rust refuses a path that climbs out; refusing it here as well means the
  // reason reaches the page rather than a log.
  if (entry.startsWith('/') || entry.split('/').includes('..')) {
    return bad(`manifest.toml starts at ${entry}, which is outside the plugin's folder`)
  }

  /** @type {string[]} */
  const notices = []
  /** @type {string[]} */
  const unofferedSlots = []

  const slots = readSlots(table['slots'], notices, unofferedSlots)
  if (typeof slots === 'string') return bad(slots)

  const capabilities = readCapabilities(table['permissions'])
  if (typeof capabilities === 'string') return bad(capabilities)

  const open = readOpen(table['permissions'], notices)
  if (typeof open === 'string') return bad(open)

  const settings = readSettings(table['settings'], notices)
  return { entry, slots, unofferedSlots, capabilities, open, error: null, notices, settings }
}

/**
 * The questions a plugin says it answers.
 *
 * A slot from a later version of the planner is dropped with a line rather
 * than refused: a plugin that also does something this app understands should
 * do that much. Its name is also collected in `unofferedSlots`, so a caller
 * can tell "the manifest asked for this and it was dropped" apart from "the
 * manifest never asked for this at all" - config.toml can be wrong about
 * either, but only one of them already has a notice.
 *
 * @param {unknown} raw
 * @param {string[]} notices
 * @param {string[]} unofferedSlots
 * @returns {string[]|string} a string is an error
 */
function readSlots(raw, notices, unofferedSlots) {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some((one) => typeof one !== 'string')) {
    return 'manifest.toml lists slots as something other than a list of names'
  }

  /** @type {string[]} */
  const kept = []
  for (const name of /** @type {string[]} */ (raw)) {
    if (!isSlot(name)) {
      notices.push(`manifest.toml asks for the ${name} slot, which this planner does not offer`)
      if (!unofferedSlots.includes(name)) unofferedSlots.push(name)
      continue
    }
    // Declared twice is declared once. The list becomes a tick per slot in
    // the pane, and two ticks for one sentence is not a question.
    if (!kept.includes(name)) kept.push(name)
  }
  return kept
}

/**
 * @param {unknown} permissions
 * @returns {string[]|string} a string is an error
 */
function readCapabilities(permissions) {
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
function readOpen(permissions, notices) {
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
      if (!IDENTIFIER.test(key)) {
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

/**
 * A plugin's own settings schema, in the order the manifest declares them.
 *
 * A key that will not do is dropped with a line rather than refusing the whole
 * plugin: the other settings still work, and so does everything the plugin
 * does that does not read the bad one.
 *
 * @param {unknown} raw  the `settings` table
 * @param {string[]} notices
 * @returns {SettingsField[]}
 */
function readSettings(raw, notices) {
  if (raw === undefined) return []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    notices.push('manifest.toml has a settings key that is not a table')
    return []
  }

  /** @type {SettingsField[]} */
  const fields = []
  for (const [key, declared] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    if (!IDENTIFIER.test(key)) {
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
