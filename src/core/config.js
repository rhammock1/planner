// @ts-check

/**
 * `~/.planner/config.toml` - reading it, and changing it without disturbing
 * the parts the app did not write (spec §3.6).
 *
 * A config the app cannot use never stops it starting. Anything wrong comes
 * back as a notice beside a working set of defaults, because refusing to open
 * a planner over a typo in a settings file is worse than opening it with the
 * defaults and saying so (spec §8).
 */

import { parseToml, getPath } from './toml.js'
import { updateToml } from './tomlEdit.js'

/** @typedef {import('./toml.js').TomlValue} TomlValue */
/** @typedef {import('./toml.js').TomlTable} TomlTable */

/**
 * @typedef {object} PluginConfig
 * @property {boolean} enabled
 * @property {string[]} approvedCapabilities
 */

/**
 * @typedef {object} Config
 * @property {string} vault
 * @property {string} theme
 * @property {string} hotkey
 * @property {number} horizonLeadDays  default when an item carries no `~Nd`
 * @property {number} carryForwardScanDays
 * @property {boolean} menuBarCount
 * @property {boolean} menuBarHorizonDot
 * @property {string} editor  a command line; falls back to $VISUAL, then $EDITOR,
 *   then the system default, all of which is decided outside core
 * @property {Map<string, PluginConfig>} plugins
 */

/** @typedef {'string'|'count'|'boolean'} FieldType */

/**
 * One row per setting, driving the defaults, the reader and the writer at
 * once. A setting added here needs no other change.
 *
 * @type {{name: keyof Config, key: string, type: FieldType, fallback: string|number|boolean}[]}
 */
const FIELDS = [
  { name: 'vault', key: 'vault', type: 'string', fallback: '~/Planner' },
  { name: 'theme', key: 'theme', type: 'string', fallback: 'ledger' },
  { name: 'hotkey', key: 'hotkey', type: 'string', fallback: 'Alt+Space' },
  { name: 'horizonLeadDays', key: 'horizon_lead_days', type: 'count', fallback: 7 },
  { name: 'carryForwardScanDays', key: 'carry_forward_scan_days', type: 'count', fallback: 30 },
  { name: 'menuBarCount', key: 'menu_bar_count', type: 'boolean', fallback: true },
  { name: 'menuBarHorizonDot', key: 'menu_bar_horizon_dot', type: 'boolean', fallback: true },
  { name: 'editor', key: 'editor', type: 'string', fallback: '' },
]

/** The settings as they stand before any file is read. @type {Config} */
export const DEFAULTS = Object.freeze(buildDefaults())

/**
 * What gets written on first run. Aligned and commented, because the file is
 * meant to be opened in an editor as readily as in the settings pane.
 */
export const DEFAULT_CONFIG_TEXT = [
  '# planner - settings. Edit here or in the settings pane; both write this file.',
  '',
  'vault                   = "~/Planner"',
  'theme                   = "ledger"',
  'hotkey                  = "Alt+Space"',
  'horizon_lead_days       = 7        # default when an item has no ~Nd',
  'carry_forward_scan_days = 30',
  'menu_bar_count          = true     # remaining count on the icon',
  'menu_bar_horizon_dot    = true     # dot when something is inside its lead time',
  'editor                  = ""       # a command; falls back to $VISUAL, $EDITOR, then `open`',
  '',
].join('\n')

/**
 * @param {string} text the contents of config.toml
 * @returns {{config: Config, notices: string[]}} notices are for the user to see
 */
export function readConfig(text) {
  /** @type {string[]} */
  const notices = []

  /** @type {TomlTable} */
  let table = {}
  try {
    table = parseToml(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { config: buildDefaults(), notices: [`config.toml could not be read (${detail}); using defaults`] }
  }

  const config = buildDefaults()
  for (const field of FIELDS) {
    const raw = getPath(table, [field.key])
    if (raw === undefined) continue
    const value = coerce(raw, field.type)
    if (value === null) {
      notices.push(`config.toml: ${field.key} is not a ${describe(field.type)}; using ${JSON.stringify(field.fallback)}`)
      continue
    }
    assign(config, field.name, value)
  }

  config.plugins = readPlugins(table, notices)
  return { config, notices }
}

/**
 * Changes settings in the text of a config file.
 *
 * The file is edited rather than regenerated, so comments, alignment and keys
 * from a newer version of the app all survive a write from an older one.
 *
 * @param {string} text
 * @param {Partial<Omit<Config, 'plugins'>>} patch
 * @returns {string}
 */
export function updateConfig(text, patch) {
  /** @type {import('./tomlEdit.js').TomlChange[]} */
  const changes = []
  for (const field of FIELDS) {
    const value = patch[/** @type {keyof Omit<Config, 'plugins'>} */ (field.name)]
    if (value === undefined) continue
    changes.push({ path: [field.key], value })
  }
  return updateToml(text, changes)
}

/**
 * Switches a plugin on or off, and says what it may reach (spec §7).
 *
 * Its own function because a plugin's settings live in a table of their own,
 * named after a folder the user put there - which is not something the FIELDS
 * table above can describe.
 *
 * @param {string} text
 * @param {string} name  the plugin's folder name
 * @param {PluginConfig} settings
 * @returns {string}
 */
export function updatePlugin(text, name, settings) {
  return updateToml(text, [
    { path: ['plugins', name, 'enabled'], value: settings.enabled },
    { path: ['plugins', name, 'approved_capabilities'], value: settings.approvedCapabilities },
  ])
}

/**
 * Resolves a leading `~` against a home directory. Paths in the config are
 * written the way a person writes them; core has no home directory of its
 * own, so it is passed in.
 *
 * @param {string} path
 * @param {string} home
 * @returns {string}
 */
export function expandHome(path, home) {
  if (path === '~') return home
  if (path.startsWith('~/')) return home + path.slice(1)
  return path
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
function readPlugins(table, notices) {
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
    const enabled = coerce(entry['enabled'] ?? false, 'boolean')
    if (enabled === null) notices.push(`config.toml: plugins.${name}.enabled is not a boolean; treating it as disabled`)
    plugins.set(name, {
      enabled: enabled === null ? false : Boolean(enabled),
      approvedCapabilities: readCapabilities(name, entry['approved_capabilities'], notices),
    })
  }
  return plugins
}

/**
 * @param {string} name
 * @param {TomlValue|TomlTable|undefined} raw
 * @param {string[]} notices
 * @returns {string[]}
 */
function readCapabilities(name, raw, notices) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    notices.push(`config.toml: plugins.${name}.approved_capabilities is not a list; treating it as empty`)
    return []
  }
  return [...raw]
}

/**
 * @param {TomlValue|TomlTable} raw
 * @param {FieldType} type
 * @returns {string|number|boolean|null} null when the value is unusable
 */
function coerce(raw, type) {
  if (type === 'string') return typeof raw === 'string' ? raw : null
  if (type === 'boolean') return typeof raw === 'boolean' ? raw : null
  // A count of days is only meaningful as a whole number that is not negative.
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null
}

/**
 * @param {FieldType} type
 * @returns {string}
 */
function describe(type) {
  return type === 'count' ? 'whole number of days' : type
}

/**
 * @param {Config} config
 * @param {keyof Config} name
 * @param {string|number|boolean} value
 * @returns {void}
 */
function assign(config, name, value) {
  // The FIELDS table pairs each name with the type its coercion produces, so
  // this cast is checked by the row above rather than by the compiler.
  /** @type {any} */ (config)[name] = value
}

/** @returns {Config} */
function buildDefaults() {
  /** @type {any} */
  const config = { plugins: new Map() }
  for (const field of FIELDS) config[field.name] = field.fallback
  return config
}
