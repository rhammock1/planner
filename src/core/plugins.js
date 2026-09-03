// @ts-check

/**
 * Which plugins to start, and with what (spec §7, §1.1).
 *
 * Two files have an opinion and they are not the same opinion. The manifest
 * says what a plugin wants; `config.toml` says what it may have. This module
 * settles the two, and every disagreement comes back as a line for the page
 * rather than a silence.
 *
 * **The manifest is the ceiling.** A slot or a capability the config approves
 * that the manifest never asked for is not granted - the plugin's own
 * declaration is the smaller of the two, and enlarging it from outside would
 * let a config hand a plugin something its author never wrote code to use.
 *
 * A slot is approved for the same reason a capability is. It is not reach; it
 * is what the plugin is *shown*, and `item.badge` is shown every line on the
 * page you are looking at.
 */

import { readManifest } from './manifest.js'
import { isSlot } from './slots.js'

/** @typedef {import('./config.js').PluginConfig} PluginConfig */

/**
 * @typedef {object} Start
 * @property {string} name
 * @property {string} entry  the file the plugin begins at
 * @property {string[]} slots  granted: declared and approved
 * @property {string[]} capabilities  granted: asked for and approved
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
 * @property {string|null} problem  why it cannot run, when it cannot
 */

/**
 * What a plugin folder may be called.
 *
 * The name becomes a URL host, a window label and a `config.toml` table
 * header, and `tomlEdit` writes headers verbatim - a folder called
 * `x]\n[plugins.other` would write another plugin's config (spec §0.2). So
 * the name is checked before anything else about the folder is believed,
 * including its manifest.
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
 *
 * @param {Folder[]} folders
 * @param {Map<string, PluginConfig>} configured
 * @returns {Installed[]}
 */
export function installed(folders, configured) {
  return folders.map((folder) => {
    const settings = configured.get(folder.name)
    const enabled = settings?.enabled === true

    // Before the manifest is read: a folder that cannot be a plugin has not
    // earned a reading of anything else it says.
    if (!isPluginName(folder.name)) {
      return {
        name: folder.name,
        enabled,
        slots: [], approvedSlots: [], asked: [], approved: [],
        problem: BAD_NAME,
      }
    }

    const read = readManifest(folder.manifest)
    return {
      name: folder.name,
      enabled,
      slots: read.slots,
      approvedSlots: both(read.slots, settings?.approvedSlots),
      asked: read.capabilities,
      approved: both(read.capabilities, settings?.approvedCapabilities),
      problem: read.error,
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

    // read.slots already dropped names this planner does not offer, with its
    // own notice for each (above). settings.approvedSlots has not - so an
    // unoffered name approved in the config is filtered out here too, or it
    // would earn a second, contradictory notice: "does not ask for it" for a
    // name the manifest just asked for, one line up.
    disagreements(folder.name, 'slot', read.slots, settings.approvedSlots.filter(isSlot), notices)
    disagreements(folder.name, 'capability', read.capabilities, settings.approvedCapabilities, notices)

    start.push({
      name: folder.name,
      entry: read.entry,
      slots: both(read.slots, settings.approvedSlots),
      capabilities: both(read.capabilities, settings.approvedCapabilities),
    })
  }

  return { start, notices }
}

/**
 * The intersection, in the manifest's order: the manifest is the ceiling, so
 * what it does not ask for cannot be granted however the config is written.
 *
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
 *
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
