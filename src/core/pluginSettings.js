// @ts-check

/**
 * A plugin's settings, checked against the schema it declared - and the
 * `[permissions.open]` entries that read one of them, since resolving those
 * needs the same settled values.
 *
 * Split out of `plugins.js` because this is where the manifest-is-ceiling
 * rule gets applied a third time (spec §2.2), on top of slots and
 * capabilities, and `plugins.js` had no room left to say so at length.
 */

import { resolvePrefix } from './urls.js'

/** @typedef {import('./settingsSchema.js').SettingsField} SettingsField */
/** @typedef {import('./toml.js').TomlValue} TomlValue */

/**
 * @typedef {{name: string, rule: 'date'}
 *   | {name: string, rule: 'setting', key: string, value: string|null}} GrantedBind
 */

/**
 * @typedef {object} GrantedCommand
 * @property {string} name
 * @property {string[]} command
 * @property {GrantedBind[]} binds
 */

/**
 * The manifest is the ceiling here too: a key in `config.toml` the manifest
 * never declared is a typo, not a permission, and is not handed over. A value
 * of the wrong kind is dropped with a line and the default used, because a
 * planner that refuses to start over a settings typo is worse than one that
 * starts and says so (spec §8).
 *
 * @param {string} name
 * @param {SettingsField[]} schema
 * @param {Map<string, TomlValue>} held
 * @param {string[]} notices
 * @returns {Map<string, TomlValue>}
 */
export function settled(name, schema, held, notices) {
  /** @type {Map<string, TomlValue>} */
  const settings = new Map()

  for (const field of schema) {
    const value = held.get(field.key)
    if (value !== undefined && kindOf(value) === field.kind) {
      settings.set(field.key, value)
      continue
    }
    if (value !== undefined) {
      notices.push(`config.toml: plugins.${name}.settings.${field.key} is not a ${field.kind}; using the default`)
    }
    // A key with no default and no value is absent from what the plugin
    // sees, rather than present and empty.
    if (field.fallback !== null) settings.set(field.key, field.fallback)
  }
  return settings
}

/**
 * The settings the *person* set, as opposed to the ones the manifest defaults
 * to (spec §3.2).
 *
 * The distinction matters in exactly one place: binding a value into a command
 * that will be run. A default is the author's string, and approving a command
 * whose arguments come from the author is approving whatever the author writes
 * next. So a default does not bind, and this is the reader that tells the two
 * apart - the same kind check `settled` makes, without the fallback.
 *
 * @param {SettingsField[]} schema
 * @param {Map<string, TomlValue>} held
 * @returns {Map<string, TomlValue>}
 */
export function personSet(schema, held) {
  /** @type {Map<string, TomlValue>} */
  const set = new Map()
  for (const field of schema) {
    const value = held.get(field.key)
    if (value !== undefined && kindOf(value) === field.kind) set.set(field.key, value)
  }
  return set
}

/**
 * The commands a plugin is granted, with every placeholder's rule settled.
 *
 * Approval is by the rendered line, entry for entry: a manifest that changed
 * an argument renders to a different line, and a different line is not the
 * one that was ticked (spec §1.6).
 *
 * A `settings.<key>` rule carries the value it will be bound to, or null when
 * the person has not set one. That value is the whole of what Rust uses - the
 * call says nothing about a setting - so this is where a command's arguments
 * are actually decided (spec §3.2, as amended in this plan).
 *
 * Null rather than dropping the command: the command is still what was
 * approved, and it is the *call* that is refused - which is what lets the
 * refusal name the setting that is missing.
 *
 * @param {string} name
 * @param {import('./permissions.js').RunCommand[]} declared
 * @param {Map<string, string>} approvedRun
 * @param {Map<string, TomlValue>} set  what the person set, from `personSet`
 * @param {string[]} notices
 * @returns {GrantedCommand[]}
 */
export function resolveRun(name, declared, approvedRun, set, notices) {
  /** @type {GrantedCommand[]} */
  const granted = []

  for (const command of declared) {
    if (!isApproved(command, approvedRun)) {
      notices.push(`${name} asks to run ${command.name}, which config.toml has not approved as it is now written`)
      continue
    }
    granted.push({
      name: command.name,
      command: command.command,
      binds: command.binds.map((bind) => bind.rule === 'date'
        ? { name: bind.name, rule: /** @type {'date'} */ ('date') }
        : {
            name: bind.name,
            rule: /** @type {'setting'} */ ('setting'),
            key: bind.key,
            value: valueOf(set.get(bind.key)),
          }),
    })
  }
  return granted
}

/**
 * Whether `config.toml` approves this command exactly as it is now written.
 *
 * One predicate, exported for the same reason `valueOf` is: the pane, the
 * planner and the notice all have to be asking the same question. Three copies
 * of "is this approved" is three chances for the pane to show a tick over a
 * command `plan()` will not grant (spec §1.6).
 *
 * An empty line is never equal to a rendered command, which is what makes an
 * unticked leftover key read as exactly what it means.
 *
 * @param {{name: string, line: string}} command
 * @param {Map<string, string>} approvedRun
 * @returns {boolean}
 */
export function isApproved(command, approvedRun) {
  return approvedRun.get(command.name) === command.line
}

/**
 * What a setting looks like on a command line.
 *
 * Exported because `installed.js` shows the person the same string this binds,
 * and two copies of "what the value will be" that could drift apart is the one
 * thing the pane must not have.
 *
 * A `count` arrives as a number and leaves as its digits: every argument is a
 * string by the time it reaches `argv`, and a plugin reading the same setting
 * through `planner.settings` still gets the number. The two are separate
 * paths and a plugin never has to reconcile them, which is the point of
 * binding from the grant rather than from the call.
 *
 * @param {TomlValue|undefined} value
 * @returns {string|null}
 */
export function valueOf(value) {
  if (value === undefined) return null
  return String(value)
}

/**
 * The manifest's own `open` entries, resolved against the settled settings.
 *
 * A literal entry passes through unchanged; a `settings.<key>` entry is
 * resolved here, where the settled values are known. `Installed.open` and
 * `Start.open` (in `plugins.js`) both go through this, so the pane's tick and
 * the address handed to Rust are the same string.
 *
 * @param {string} name
 * @param {string[]} open
 * @param {Map<string, TomlValue>} settings
 * @param {string[]} notices
 * @returns {string[]}
 */
export function resolveOpen(name, open, settings, notices) {
  /** @type {string[]} */
  const kept = []
  for (const entry of open) {
    const read = resolvePrefix(entry, /** @type {Map<string, string|number|boolean>} */ (settings))
    if (read.error !== null) {
      notices.push(`${name}: ${read.error}`)
      continue
    }
    if (!kept.includes(read.prefix)) kept.push(read.prefix)
  }
  return kept
}

/**
 * @param {TomlValue} value
 * @returns {string}
 */
function kindOf(value) {
  if (typeof value === 'string') return 'text'
  if (typeof value === 'boolean') return 'switch'
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return 'count'
  return 'none'
}
