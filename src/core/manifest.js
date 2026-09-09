// @ts-check

/**
 * Reading `manifest.toml` - what a plugin declares about itself.
 *
 * The one place this file is understood. It stays inside what `core/toml.js`
 * parses: bare keys, strings, numbers, booleans, single-line arrays of
 * strings, and `[dotted.table]` headers (spec §1.1).
 *
 * What a manifest says falls into three parts, and each has a file. Here:
 * where to start, which questions it answers, and what each of those questions
 * needs to know that the question itself does not carry. In `permissions.js`:
 * what it reaches outside itself. In `settingsSchema.js`: its own config.
 *
 * There are two kinds of wrong. An `error` is a manifest this app cannot act
 * on at all, and the plugin does not start. A `notice` is a manifest it can
 * act on with a part left out - a slot from a later version of the planner,
 * say - and the plugin runs without that part. Neither is ever guessed at.
 */

import { parseToml } from './toml.js'
import { isSlot, optionsTableOf } from './slots.js'
import { readCapabilities, readOpen, readRun } from './permissions.js'
import { readSettings } from './settingsSchema.js'
import { isPrefix, LONGEST_PREFIX } from './sidecars.js'

/** @typedef {import('./toml.js').TomlValue} TomlValue */
/** @typedef {import('./settingsSchema.js').SettingsField} SettingsField */

/**
 * @typedef {object} Manifest
 * @property {string} entry  the file the plugin begins at
 * @property {string[]} slots  declared, and offered by this version
 * @property {string[]} unofferedSlots  declared, but not offered by this
 *   version - config.toml approving one of these too is not a second
 *   complaint, since this file already made the first one
 * @property {string[]} capabilities  declared; the config decides the rest
 * @property {string[]} open  addresses this plugin says it may open
 * @property {import('./permissions.js').RunCommand[]} run  commands this
 *   plugin says it may run, in name order
 * @property {Map<string, Record<string, TomlValue>>} options  per declared
 *   slot, the table named for its last word - what that slot needs to know
 *   that the question does not carry (spec §1.1)
 * @property {string[]} prefixes  the sidecar suffixes this plugin owns, as
 *   `[sidecars] prefixes` declares them. A declaration of ownership rather
 *   than a slot's options, which is why it has a table of its own (spec §1.1)
 * @property {string|null} error  why it cannot run, when it cannot
 * @property {string[]} notices  what was left out, and why
 * @property {SettingsField[]} settings  the plugin's own settings schema
 */

/**
 * @param {string} text  the contents of manifest.toml
 * @returns {Manifest}
 */
export function readManifest(text) {
  /** @param {string} error @returns {Manifest} */
  const bad = (error) => ({
    entry: '', slots: [], unofferedSlots: [], capabilities: [], open: [],
    run: [], options: new Map(), prefixes: [], error, notices: [], settings: [],
  })

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

  const run = readRun(table['permissions'], notices)
  if (typeof run === 'string') return bad(run)

  const prefixes = readPrefixes(table['sidecars'], notices)
  const options = readOptions(table, slots, notices)
  const settings = readSettings(table['settings'], notices)
  return { entry, slots, unofferedSlots, capabilities, open, run, options, prefixes, error: null, notices, settings }
}

/**
 * The sidecar suffixes a plugin says are its (spec §4.1).
 *
 * A prefix it cannot make a filename out of is dropped with a line rather than
 * refused whole: a plugin declaring three prefixes and mistyping one should
 * still own the other two, and the line is what tells its author which.
 *
 * @param {unknown} declared  the `[sidecars]` table
 * @param {string[]} notices
 * @returns {string[]}
 */
function readPrefixes(declared, notices) {
  if (declared === undefined) return []
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    notices.push('manifest.toml has a sidecars key that is not a table')
    return []
  }

  const raw = /** @type {Record<string, unknown>} */ (declared)['prefixes']
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some((one) => typeof one !== 'string')) {
    notices.push('manifest.toml lists sidecar prefixes as something other than a list of names')
    return []
  }

  /** @type {string[]} */
  const kept = []
  for (const prefix of /** @type {string[]} */ (raw)) {
    if (!isPrefix(prefix)) {
      notices.push(
        `manifest.toml claims the ${prefix} sidecar prefix, which is not lowercase words joined by single hyphens, at most ${LONGEST_PREFIX} characters`,
      )
      continue
    }
    // Claimed twice is claimed once, the same way `slots` is.
    if (!kept.includes(prefix)) kept.push(prefix)
  }
  return kept
}

/**
 * What a slot needs to know that the question does not carry.
 *
 * Read only for a slot the manifest declares, so a table for a question that
 * will never be put to this plugin is never read - which is what keeps the
 * pane's ticks and the manifest's tables describing the same thing.
 *
 * @param {import('./toml.js').TomlTable} table
 * @param {string[]} slots  the declared, offered ones
 * @param {string[]} notices
 * @returns {Map<string, Record<string, TomlValue>>}
 */
function readOptions(table, slots, notices) {
  /** @type {Map<string, Record<string, TomlValue>>} */
  const options = new Map()

  for (const slot of slots) {
    const named = optionsTableOf(slot)
    if (named === null) continue

    const declared = table[named]
    if (declared === undefined) continue
    if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
      notices.push(`manifest.toml has a ${named} key that is not a table of options for ${slot}`)
      continue
    }

    /** @type {Record<string, TomlValue>} */
    const kept = {}
    for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (declared))) {
      // A nested table is not an option: every option this design has is a
      // value, and `[contribute.something]` is a table from a later version.
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) continue
      kept[key] = /** @type {TomlValue} */ (value)
    }
    options.set(slot, kept)
  }
  return options
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
 * One reader for every slot's options (spec §1.1).
 *
 * @param {Manifest} manifest
 * @param {string} slot
 * @returns {Record<string, TomlValue>}
 */
export function slotOptions(manifest, slot) {
  return manifest.options.get(slot) ?? {}
}

/**
 * An option that is text, as a page may show it: one line, cut.
 *
 * A manifest is somebody else's file and a heading is drawn on the day page,
 * so it obeys the same rule everything a plugin says obeys (spec §1.3).
 * Missing, or not a string, reads as nothing - which is how a caller says
 * "then use the plugin's own name" without this reader having an opinion.
 *
 * @param {Record<string, TomlValue>} options
 * @param {string} key
 * @param {number} longest
 * @returns {string}
 */
export function optionText(options, key, longest) {
  const raw = options[key]
  if (typeof raw !== 'string') return ''
  const line = raw.replace(/\s+/gu, ' ').trim()
  return line.length <= longest ? line : `${line.slice(0, longest - 1)}…`
}

/**
 * An option that is a list of names.
 *
 * Named twice is named once, the same way `slots` is: every list of names in
 * this design becomes a set of things approved or moved, and a name appearing
 * twice does not double anything.
 *
 * @param {Record<string, TomlValue>} options
 * @param {string} key
 * @returns {string[]}
 */
export function optionNames(options, key) {
  const raw = options[key]
  if (!Array.isArray(raw)) return []

  /** @type {string[]} */
  const kept = []
  for (const one of raw) {
    if (typeof one !== 'string' || kept.includes(one)) continue
    kept.push(one)
  }
  return kept
}
