// @ts-check

/**
 * What a manifest's `[permissions]` tables ask for.
 *
 * Its own file because this is the half of a manifest that grows: a capability
 * that carries a list of things it may reach - addresses (spec §2.1), commands
 * (spec §3.2) - brings its own table and its own rules with it, and every one
 * of those rules is about reach rather than about what the plugin is.
 *
 * Nothing here decides anything. It reads what was asked for; `plan()` settles
 * it against what `config.toml` approved.
 */

import { isBareKey } from './toml.js'
import { renderCommand, placeholdersOf } from './commands.js'
import { readPrefix } from './urls.js'

/**
 * @param {unknown} permissions
 * @returns {string[]|string} a string is an error
 */
export function readCapabilities(permissions) {
  if (permissions === undefined) return []
  // `null` too, and not only because TOML has none: this takes `unknown`, the
  // cast below is what stops the type-checker noticing, and its two siblings
  // both answer this question the same way.
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
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
export function readOpen(permissions, notices) {
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
      if (!isBareKey(key)) {
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
 * @typedef {object} RunCommand
 * @property {string} name  the name in `[permissions.run.<name>]`, and in
 *   `[plugins.<plugin>.run]`
 * @property {string[]} command  the argument list, placeholders and all
 * @property {RunBind[]} binds  one per placeholder, in first-appearance order
 * @property {string} line  the rendering a person approves by (spec §1.6),
 *   with each placeholder carrying the rule that binds it
 */

/**
 * @typedef {object} RunBind
 * @property {string} name  the placeholder
 * @property {'date'|'setting'} rule
 * @property {string} key  the setting's name; `''` for a date
 */

/** What the manifest is allowed to say a placeholder is bound to. */
const SETTING = 'settings.'

/**
 * What an argument may be made of.
 *
 * Printable ASCII, because the argument becomes a label a person reads and
 * ticks. A tab and a non-breaking space are drawn as a space and collapse to
 * one in HTML, so the word boundaries in the label would stop matching the
 * argument boundaries in `argv`; a bidi control reorders the label without
 * touching what runs. Neither belongs in a program name or a flag, and a
 * value that needs them arrives through a setting, at run time, in Rust -
 * never through here.
 */
const PRINTABLE = /^[\x20-\x7E]*$/

/**
 * The commands a plugin says it may run (spec §3.2).
 *
 * Every rule here is about the same thing: a person has to be able to read
 * what will run and know that it is what runs. So the program is fixed, every
 * placeholder is accounted for in both directions, and the rendered line comes
 * out of here rather than out of whoever needs it - the pane and `plan()` must
 * be comparing the same string.
 *
 * A command that will not do is dropped with a line rather than refusing the
 * whole plugin: the other commands still work, and so does everything the
 * plugin does that does not run the bad one.
 *
 * @param {unknown} permissions
 * @param {string[]} notices
 * @returns {RunCommand[]|string} a string is an error
 */
export function readRun(permissions, notices) {
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    return []
  }
  const table = /** @type {Record<string, unknown>} */ (permissions)['run']
  if (table === undefined) return []
  if (typeof table !== 'object' || Array.isArray(table)) {
    return 'manifest.toml has a permissions.run key that is not a table of commands'
  }

  /** @type {RunCommand[]} */
  const kept = []
  for (const [name, declared] of Object.entries(/** @type {Record<string, unknown>} */ (table))) {
    if (!isBareKey(name)) {
      notices.push(`manifest.toml declares a command called ${name}, which cannot be a config.toml key`)
      continue
    }
    if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
      notices.push(`manifest.toml declares the command ${name} as something other than a table`)
      continue
    }
    const one = /** @type {Record<string, unknown>} */ (declared)

    const command = one['command']
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string')) {
      notices.push(`manifest.toml does not give the command ${name} an argument list`)
      continue
    }
    const args = /** @type {string[]} */ (command)
    // An empty argument is what a manifest looks like when it built its list
    // out of something that was not there. The rendering shows it faithfully
    // as `''`, so this is not about the line being honest - it is that a hole
    // in an argument list is a bug, and running it is not what was approved.
    if (args.some((part) => part === '')) {
      notices.push(`manifest.toml gives the command ${name} an empty argument`)
      continue
    }
    if (args.some((part) => !PRINTABLE.test(part))) {
      notices.push(`manifest.toml gives the command ${name} an argument this app will not show in a tickable line`)
      continue
    }
    // The program is fixed, and that is the point of approving a command: a
    // bound program renders as `{prog}` and the tick beside it would be a
    // person approving something they cannot see (spec §3.2).
    if (/[{}]/.test(args[0] ?? '')) {
      notices.push(`manifest.toml lets the command ${name} choose the program it runs, which nobody could approve`)
      continue
    }

    const found = placeholdersOf(args)
    if (found.error !== null) {
      notices.push(`manifest.toml declares the command ${name} with an argument that ${found.error}`)
      continue
    }

    const binds = bindsOf(name, one, found.names, notices)
    if (binds === null) continue

    kept.push({ name, command: args, binds, line: renderCommand(args, binds) })
  }

  // By name, whatever order the file wrote them in: this list becomes rows in
  // the pane and keys in `config.toml`, and neither should move because a
  // manifest was reordered.
  kept.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  return kept
}

/**
 * One rule per placeholder, checked in both directions.
 *
 * A placeholder with no rule cannot be bound, and a rule for a placeholder the
 * command does not use is a manifest whose two halves disagree. Both are the
 * whole command's problem rather than one argument's, because a command that
 * runs with a hole in it is not the command that was approved.
 *
 * @param {string} name
 * @param {Record<string, unknown>} declared
 * @param {string[]} placeholders
 * @param {string[]} notices
 * @returns {RunBind[]|null} null when the command is not granted
 */
function bindsOf(name, declared, placeholders, notices) {
  /** @type {RunBind[]} */
  const binds = []

  for (const placeholder of placeholders) {
    const rule = declared[placeholder]
    if (rule === 'date') {
      binds.push({ name: placeholder, rule: 'date', key: '' })
      continue
    }
    if (typeof rule === 'string' && rule.startsWith(SETTING)) {
      const key = rule.slice(SETTING.length)
      if (!isBareKey(key)) {
        notices.push(`manifest.toml binds {${placeholder}} in ${name} to ${rule}, whose setting name is not one config.toml could hold`)
        return null
      }
      binds.push({ name: placeholder, rule: 'setting', key })
      continue
    }
    notices.push(`manifest.toml does not say how to bind {${placeholder}} in the command ${name}`)
    return null
  }

  for (const key of Object.keys(declared)) {
    if (key === 'command' || placeholders.includes(key)) continue
    notices.push(`manifest.toml binds ${key} in the command ${name}, which its command does not use`)
    return null
  }

  return binds
}
