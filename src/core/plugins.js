// @ts-check

/**
 * Which plugins to start, and with what (spec §7, §1.1).
 *
 * Two files have an opinion and they are not the same opinion. The manifest
 * says what a plugin wants; `config.toml` says what it may have. This module
 * settles the two, and every disagreement comes back as a line for the page
 * rather than a silence.
 *
 * **The manifest is the ceiling.** A slot, a capability or an address the
 * config approves that the manifest never asked for is not granted - the
 * plugin's own declaration is the smaller of the two, and enlarging it from
 * outside would let a config hand a plugin something its author never wrote
 * code to use.
 *
 * A slot is approved for the same reason a capability is. It is not reach; it
 * is what the plugin is *shown*, and `item.badge` is shown every line on the
 * page you are looking at.
 */

import { readManifest } from './manifest.js'
import { settled, resolveOpen } from './pluginSettings.js'

/** @typedef {import('./config.js').PluginConfig} PluginConfig */
/** @typedef {import('./settingsSchema.js').SettingsField} SettingsField */
/** @typedef {import('./toml.js').TomlValue} TomlValue */

/**
 * @typedef {object} Start
 * @property {string} name
 * @property {string} entry  the file the plugin begins at
 * @property {string[]} slots  granted: declared and approved
 * @property {string[]} capabilities  granted: asked for and approved
 * @property {string[]} open  addresses granted: declared and approved
 * @property {Map<string, TomlValue>} settings  checked against the manifest's schema
 */

/** @typedef {{name: string, manifest: string}} Folder */

/**
 * A plugin as the settings pane needs to show it.
 *
 * @typedef {object} Installed
 * @property {string} name
 * @property {boolean} enabled
 * @property {string[]} slots  slots the manifest declares
 * @property {string[]} approvedSlots  of those, the ones config.toml allows
 * @property {string[]} asked  capabilities the manifest asks for
 * @property {string[]} approved  of those, the ones config.toml has allowed
 * @property {string[]} open  addresses the manifest declares
 * @property {string[]} approvedOpen  of those, the ones config.toml allows
 * @property {string|null} problem  why it cannot run, when it cannot
 * @property {SettingsField[]} schema  the settings the manifest declares
 * @property {Map<string, TomlValue>} settings  the settled values, checked against schema
 */

/**
 * What a plugin folder may be called.
 *
 * The name becomes a URL host, a window label and a `config.toml` table
 * header, and `tomlEdit` writes headers verbatim - a folder called
 * `x]\n[plugins.other` would write another plugin's config (spec §0.2), so
 * the name is checked before anything else about the folder is believed.
 */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Said the same way in both places a folder is refused for its name. */
const BAD_NAME =
  'the folder name may only be lowercase letters, digits and hyphens, starting with a letter or a digit'

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isPluginName(name) {
  return NAME.test(name)
}

/**
 * Every plugin folder on disk, settled against the config (spec §7).
 * @param {Folder[]} folders
 * @param {Map<string, PluginConfig>} configured
 * @returns {Installed[]}
 */
export function installed(folders, configured) {
  return folders.map((folder) => {
    const configEntry = configured.get(folder.name)
    const enabled = configEntry?.enabled === true

    // Before the manifest is read: a folder that cannot be a plugin has not
    // earned a reading of anything else it says.
    if (!isPluginName(folder.name)) {
      return {
        name: folder.name,
        enabled,
        slots: [], approvedSlots: [], asked: [], approved: [], open: [], approvedOpen: [],
        problem: BAD_NAME,
        schema: [],
        settings: new Map(),
      }
    }

    const read = readManifest(folder.manifest)
    const settings = settled(folder.name, read.settings, configEntry?.settings ?? new Map(), [])
    // An unset settings-derived entry resolves to nothing, so it is simply
    // not offered rather than shown as the literal `settings.<key>` string.
    const open = resolveOpen(folder.name, read.open, settings, [])
    return {
      name: folder.name,
      enabled,
      slots: read.slots,
      approvedSlots: both(read.slots, configEntry?.approvedSlots),
      asked: read.capabilities,
      approved: both(read.capabilities, configEntry?.approvedCapabilities),
      open,
      approvedOpen: both(open, configEntry?.approvedOpen),
      problem: read.error,
      schema: read.settings,
      settings,
    }
  })
}

/**
 * @param {Folder[]} folders  every plugin folder found on disk
 * @param {Map<string, PluginConfig>} configured
 * @returns {{start: Start[], notices: string[]}}
 */
export function plan(folders, configured) {
  /** @type {Start[]} */
  const start = []
  /** @type {string[]} */
  const notices = []

  for (const folder of folders) {
    const settings = configured.get(folder.name)
    // Installed but not switched on. Not a problem, and not worth a line:
    // a folder sitting in ~/.planner/plugins is how a plugin waits.
    if (settings === undefined || !settings.enabled) continue

    // After the enabled check, not before it: a folder sitting switched off
    // is how a plugin waits, and a waiting plugin is not a fault to report.
    if (!isPluginName(folder.name)) {
      notices.push(`${folder.name}: ${BAD_NAME}`)
      continue
    }

    const read = readManifest(folder.manifest)
    if (read.error !== null) {
      notices.push(`${folder.name}: ${read.error}`)
      continue
    }
    for (const line of read.notices) notices.push(`${folder.name}: ${line}`)

    // A name in both read.unofferedSlots and settings.approvedSlots was
    // asked for by the manifest and already earned its notice above ("does
    // not offer") - it is dropped here so it does not also earn the
    // contradicting "does not ask for it". A name config.toml approves that
    // the manifest never mentioned at all is not in unofferedSlots, so it
    // keeps its notice below, same as a bogus capability would.
    const approvedSlots = settings.approvedSlots.filter((one) => !read.unofferedSlots.includes(one))
    disagreements(folder.name, 'slot', read.slots, approvedSlots, notices)
    disagreements(folder.name, 'capability', read.capabilities, settings.approvedCapabilities, notices)

    // Resolved here, not by the manifest reader: a `settings.` entry can only
    // be checked once the settings it depends on are known.
    const pluginSettings = settled(folder.name, read.settings, settings.settings, notices)
    const resolvedOpen = resolveOpen(folder.name, read.open, pluginSettings, notices)
    disagreements(folder.name, 'address', resolvedOpen, settings.approvedOpen, notices)

    start.push({
      name: folder.name,
      entry: read.entry,
      slots: both(read.slots, settings.approvedSlots),
      capabilities: both(read.capabilities, settings.approvedCapabilities),
      open: both(resolvedOpen, settings.approvedOpen),
      settings: pluginSettings,
    })
  }

  return { start, notices }
}

/**
 * A plugin's whole record as one string, for deciding whether it has changed.
 *
 * Sorted and written out by hand rather than handed to `JSON.stringify`,
 * which writes a `Map` as `{}` - settings live in one (§2.2), so a plugin
 * whose settings changed would otherwise look identical to itself (spec §1.2).
 * @param {Start} start
 * @returns {string}
 */
export function signature(start) {
  return JSON.stringify([
    start.name,
    start.entry,
    [...start.slots].sort(),
    [...start.capabilities].sort(),
    [...start.open].sort(),
    [...start.settings].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  ])
}

/**
 * What has to happen for what is running to become what is planned.
 *
 * A restart is the only way anything about a plugin changes: a page that
 * reloads is simpler than one that has to be right while its inputs move.
 * @param {Map<string, string>} running  name -> the signature it was started with
 * @param {Start[]} planned
 * @returns {{stop: string[], start: Start[]}}
 */
export function diff(running, planned) {
  /** @type {string[]} */
  const stop = []
  /** @type {Start[]} */
  const start = []

  const wanted = new Map(planned.map((one) => [one.name, one]))

  for (const [name, was] of running) {
    const now = wanted.get(name)
    if (now === undefined) {
      stop.push(name)
      continue
    }
    if (signature(now) !== was) stop.push(name)
  }
  // Settled, so two runs of the same change do the same thing in the same
  // order and a log reads the same twice.
  stop.sort()

  for (const one of planned) {
    const was = running.get(one.name)
    if (was === undefined || was !== signature(one)) start.push(one)
  }

  return { stop, start }
}

/**
 * The intersection, in the manifest's order: the manifest is the ceiling, so
 * what it does not ask for cannot be granted however the config is written.
 * @param {string[]} asked
 * @param {string[]|undefined} approved
 * @returns {string[]}
 */
function both(asked, approved) {
  const allowed = approved ?? []
  return asked.filter((one) => allowed.includes(one))
}

/**
 * One line for each side of a disagreement, so the page says what is missing
 * rather than the plugin quietly doing less than it says it does.
 * @param {string} name
 * @param {string} kind  `slot` or `capability`
 * @param {string[]} asked
 * @param {string[]} approved
 * @param {string[]} notices
 * @returns {void}
 */
function disagreements(name, kind, asked, approved, notices) {
  for (const one of asked) {
    if (!approved.includes(one)) {
      notices.push(`${name} asks for the ${one} ${kind}, which config.toml has not approved`)
    }
  }
  for (const one of approved) {
    if (!asked.includes(one)) {
      notices.push(`config.toml approves the ${one} ${kind} for ${name}, which does not ask for it`)
    }
  }
}
