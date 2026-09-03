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
 */

/**
 * @param {string} text  the contents of manifest.toml
 * @returns {Manifest}
 */
export function readManifest(text) {
  /** @param {string} error @returns {Manifest} */
  const bad = (error) => (
    { entry: '', slots: [], unofferedSlots: [], capabilities: [], open: [], error, notices: [] }
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

  return { entry, slots, unofferedSlots, capabilities, open, error: null, notices }
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
    const read = readPrefix(entry)
    if (read.error !== null) {
      notices.push(`manifest.toml asks to open ${read.error}`)
      continue
    }
    if (!kept.includes(read.prefix)) kept.push(read.prefix)
  }
  return kept
}
