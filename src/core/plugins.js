// @ts-check

/**
 * Which plugins to start, and with what (spec §7, addendum §2).
 *
 * Two files have an opinion and they are not the same opinion. The manifest
 * says what a plugin wants; `config.toml` says what it may have. This module
 * settles the two, and every disagreement comes back as a line for the page
 * rather than a silence.
 *
 * **The manifest is the ceiling.** A capability the config approves that the
 * manifest never asked for is not granted - the plugin's own declaration is
 * the smaller of the two, and enlarging it from outside would let a config
 * hand a plugin something its author never wrote code to use.
 */

import { parseToml } from './toml.js'

/** @typedef {import('./config.js').PluginConfig} PluginConfig */

/**
 * @typedef {object} Start
 * @property {string} name
 * @property {string} entry  the file the plugin begins at
 * @property {string[]} capabilities  granted: asked for and approved
 */

/** @typedef {{name: string, manifest: string}} Folder */

/**
 * A plugin as the settings pane needs to show it: what it is, whether it is
 * switched on, what it asks for and what it has been allowed.
 *
 * @typedef {object} Installed
 * @property {string} name
 * @property {boolean} enabled
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
 * `approved` is the intersection rather than what the config says, for the
 * same reason `plan` grants the intersection: the manifest is the ceiling, so
 * a pane that showed a capability ticked which the plugin never asked for
 * would be showing a permission that does not exist.
 *
 * @param {Folder[]} folders
 * @param {Map<string, PluginConfig>} configured
 * @returns {Installed[]}
 */
export function installed(folders, configured) {
  return folders.map((folder) => {
    const settings = configured.get(folder.name)
    // Before the manifest is read: a folder that cannot be a plugin has not
    // earned a reading of anything else it says.
    if (!isPluginName(folder.name)) {
      return {
        name: folder.name,
        enabled: settings?.enabled === true,
        asked: [],
        approved: [],
        problem: BAD_NAME,
      }
    }

    const read = readManifest(folder)
    const asked = read.capabilities
    const allowed = settings?.approvedCapabilities ?? []

    return {
      name: folder.name,
      enabled: settings?.enabled === true,
      asked,
      approved: asked.filter((capability) => allowed.includes(capability)),
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

    const read = readManifest(folder)
    if (read.error !== null) {
      notices.push(`${folder.name}: ${read.error}`)
      continue
    }

    const asked = read.capabilities
    const approved = settings.approvedCapabilities
    const granted = asked.filter((capability) => approved.includes(capability))

    for (const capability of asked) {
      if (!approved.includes(capability)) {
        notices.push(`${folder.name} asks for ${capability}, which config.toml has not approved`)
      }
    }
    for (const capability of approved) {
      if (!asked.includes(capability)) {
        notices.push(`config.toml approves ${capability} for ${folder.name}, which does not ask for it`)
      }
    }

    start.push({ name: folder.name, entry: read.entry, capabilities: granted })
  }

  return { start, notices }
}

/**
 * @param {Folder} folder
 * @returns {{entry: string, capabilities: string[], error: null}|{entry: string, capabilities: string[], error: string}}
 */
function readManifest(folder) {
  const bad = (/** @type {string} */ error) => ({ entry: '', capabilities: [], error })

  let table
  try {
    table = parseToml(folder.manifest)
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

  const permissions = table['permissions']
  if (permissions === undefined) return { entry, capabilities: [], error: null }
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    return bad('manifest.toml has a permissions key that is not a table')
  }

  const wanted = /** @type {Record<string, unknown>} */ (permissions)['capabilities']
  if (wanted === undefined) return { entry, capabilities: [], error: null }
  if (!Array.isArray(wanted) || wanted.some((one) => typeof one !== 'string')) {
    return bad('manifest.toml lists permissions.capabilities as something other than a list of names')
  }

  return { entry, capabilities: /** @type {string[]} */ (wanted), error: null }
}
