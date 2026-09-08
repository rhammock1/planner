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
import { settled, resolveOpen, personSet, resolveRun } from './pluginSettings.js'

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
 * @property {import('./pluginSettings.js').GrantedCommand[]} run  granted:
 *   declared and approved as written
 * @property {string[]} asked  capabilities the manifest declares, approved or
 *   not. Rust needs the difference: asking for something you declared and the
 *   person has not ticked is a decision nobody has made yet, and asking for
 *   something you never declared is a plugin that is not what it said it was.
 *   Only the second is a strike (spec §1.2).
 * @property {string[]} askedRun  command names the manifest declares, ticked
 *   or not, for the same reason
 * @property {Map<string, TomlValue>} settings  checked against the manifest's schema
 */

/**
 * A `Start` as it crosses into Rust: the same record with its settings as a
 * plain object, because JSON has no `Map`.
 *
 * Named separately from `Start` so the seam has a shape rather than a
 * parameter list. Adding a field is one edit here and one in `plan()`.
 *
 * @typedef {Omit<Start, 'settings'> & {settings: Record<string, unknown>}} Grant
 */

/** @typedef {{name: string, manifest: string}} Folder */

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
export const BAD_NAME =
  'the folder name may only be lowercase letters, digits and hyphens, starting with a letter or a digit'

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isPluginName(name) {
  return NAME.test(name)
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

    const capabilities = both(read.capabilities, settings.approvedCapabilities)

    // Approved by the line the manifest renders to now, not by the name of a
    // command - which is what makes a changed argument show up unapproved
    // rather than running under yesterday's tick (spec §1.6).
    //
    // Gated on the capability as well as the line, because Rust checks the
    // capability first and *that* refusal is a strike: three asks and the
    // plugin is put away for the session (spec §1.2). Ticking the git command
    // and leaving the plain `shell.run` box alone is the reasonable instinct -
    // the specific line looks like the sensitive one - so it must not be the
    // one that bricks a plugin.
    const run = capabilities.includes('shell.run')
      ? resolveRun(
          folder.name,
          read.run,
          settings.approvedRun,
          personSet(read.settings, settings.settings),
          notices,
        )
      : []
    if (!capabilities.includes('shell.run')) {
      // Only when there is something to say: a plugin with no ticked command
      // and no `shell.run` has nothing wrong with it.
      const ticked = read.run.filter((one) => settings.approvedRun.get(one.name) === one.line)
      if (ticked.length > 0) {
        notices.push(`${folder.name} has ${ticked.length === 1 ? 'a command' : 'commands'} approved but not shell.run, so it may not run anything`)
      }
    }

    start.push({
      name: folder.name,
      entry: read.entry,
      slots: both(read.slots, settings.approvedSlots),
      capabilities,
      open: both(resolvedOpen, settings.approvedOpen),
      run,
      asked: read.capabilities,
      askedRun: read.run.map((one) => one.name),
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
    // Written out by hand rather than handed whole to `JSON.stringify`: a
    // command's shape is this app's and a key order is not a promise, but a
    // restart on a changed command is.
    [...start.run]
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      .map((one) => [
        one.name,
        one.command,
        one.binds.map((bind) => [
          bind.name,
          bind.rule,
          bind.rule === 'setting' ? bind.key : '',
          bind.rule === 'setting' ? bind.value : null,
        ]),
      ]),
    [...start.asked].sort(),
    [...start.askedRun].sort(),
    [...start.settings].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  ])
}

/**
 * Every field `signature` reads.
 *
 * Exported for the one test that matters here: `signature` is written out by
 * hand, and a field added to `Start` and forgotten in it is a plugin that
 * silently keeps running with the grant it had before - which is the one
 * symptom this app promises never to be silent about (spec §1.2). A list this
 * short is easier to keep true than a comment asking somebody to remember.
 *
 * @type {readonly (keyof Start)[]}
 */
export const SIGNED = Object.freeze([
  'name', 'entry', 'slots', 'capabilities', 'open', 'run', 'asked', 'askedRun', 'settings',
])

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
 *
 * Exported for `installed.js`, which asks the same question of the same two
 * files and must answer it the same way.
 *
 * @param {string[]} asked
 * @param {string[]|undefined} approved
 * @returns {string[]}
 */
export function both(asked, approved) {
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
