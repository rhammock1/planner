// @ts-check

/**
 * The plugin half of the settings pane (spec §3.6, §7).
 *
 * Split out of `settingsPanel.js` because this is the half that grows: one
 * tick per slot, one per capability, one per address a capability carries,
 * and a line saying what a plugin did when it could not keep running.
 */

import { el } from '../ui/dom.js'
import { sentenceFor } from '../core/slots.js'
import { tick } from './tick.js'
import { commandRow } from './commandRows.js'

/** @typedef {import('../core/installed.js').Installed} Installed */
/** @typedef {import('../plugins/asking.js').PluginState} PluginState */
/** @typedef {import('./settingsPanel.js').SettingsHandlers} SettingsHandlers */

/**
 * @param {Installed[]} plugins
 * @param {Map<string, PluginState>} states
 * @param {SettingsHandlers} handlers
 * @returns {HTMLElement[]}
 */
export function createPluginRows(plugins, states, handlers) {
  const heading = el('div', 'settings-heading', 'Plugins')
  if (plugins.length === 0) {
    const empty = el('div', 'settings-empty', 'Nothing in ~/.planner/plugins yet.')
    return [heading, empty]
  }
  return [heading, ...plugins.map((plugin) => pluginRow(plugin, states, handlers))]
}

/**
 * @param {Installed} plugin
 * @param {Map<string, PluginState>} states
 * @param {SettingsHandlers} handlers
 * @returns {HTMLElement}
 */
function pluginRow(plugin, states, handlers) {
  const block = el('div', 'plugin')

  const line = el('label', 'setting setting-switch')
  const box = el('input', 'setting-box')
  box.setAttribute('type', 'checkbox')
  if (box instanceof HTMLInputElement) box.checked = plugin.enabled
  // A folder with a problem cannot run, so a switch beside it would be a
  // switch that does nothing - or worse, for a bad name, one that writes a
  // table header into config.toml (spec §0.2).
  if (plugin.problem !== null && box instanceof HTMLInputElement) box.disabled = true
  box.addEventListener('change', () => {
    if (box instanceof HTMLInputElement) {
      handlers.onPlugin(plugin.name, {
        enabled: box.checked,
        approvedSlots: plugin.approvedSlots,
        approvedCapabilities: plugin.approved,
        approvedOpen: plugin.approvedOpen,
        approvedRun: plugin.approvedRun,
        settings: plugin.settings,
      })
    }
  })
  line.append(box, el('span', 'setting-label', plugin.name))
  block.append(line)

  if (plugin.problem !== null) {
    block.append(el('div', 'plugin-problem', plugin.problem))
    return block
  }

  // What it is shown, one line each. The sentence is the thing being ticked:
  // `item.badge` hands a plugin every line on the page, and a permission
  // nobody was asked about is not consent (spec §1.1).
  for (const slot of plugin.slots) {
    block.append(tick(
      sentenceFor(slot),
      plugin.approvedSlots.includes(slot),
      'slot',
      (on) => handlers.onPlugin(plugin.name, {
        enabled: plugin.enabled,
        approvedSlots: toggled(plugin.approvedSlots, slot, on),
        approvedCapabilities: plugin.approved,
        approvedOpen: plugin.approvedOpen,
        approvedRun: plugin.approvedRun,
        settings: plugin.settings,
      }),
    ))
  }

  // What it asks for, one line each, so granting is a decision per capability
  // rather than a single yes to a list you did not read (spec §7.4).
  for (const capability of plugin.asked) {
    block.append(tick(
      capability,
      plugin.approved.includes(capability),
      'capability',
      (on) => handlers.onPlugin(plugin.name, {
        enabled: plugin.enabled,
        approvedSlots: plugin.approvedSlots,
        approvedCapabilities: toggled(plugin.approved, capability, on),
        approvedOpen: plugin.approvedOpen,
        approvedRun: plugin.approvedRun,
        settings: plugin.settings,
      }),
    ))
  }

  // A capability that carries a list is approved entry by entry: the reach is
  // the entry, not the name of the capability.
  if (plugin.open.length > 0) {
    for (const address of plugin.open) {
      block.append(tick(
        address,
        plugin.approvedOpen.includes(address),
        'address',
        (on) => handlers.onPlugin(plugin.name, {
          enabled: plugin.enabled,
          approvedSlots: plugin.approvedSlots,
          approvedCapabilities: plugin.approved,
          approvedOpen: toggled(plugin.approvedOpen, address, on),
          approvedRun: plugin.approvedRun,
          settings: plugin.settings,
        }),
      ))
    }
  }

  // A command is approved by its rendered line, one command at a time: the
  // reach is the program and its arguments, not the name `shell.run`.
  //
  // Both ticks are needed, and the order they are made in does not matter -
  // so the boxes stay live and the state is said out loud instead. Ticking a
  // command and stopping there is the easy mistake, because the git line is
  // the half that looks like the sensitive one.
  if (plugin.run.length > 0 && !plugin.approved.includes('shell.run')) {
    block.append(el('div', 'plugin-note', 'shell.run is not ticked, so none of these run.'))
  }
  for (const command of plugin.run) {
    block.append(commandRow(plugin, command, handlers))
  }

  // Worth saying out loud: a plugin that asks for nothing is not a plugin
  // that was refused everything.
  if (plugin.asked.length === 0) {
    block.append(el('div', 'plugin-note', 'Asks for nothing.'))
  }

  // One row per settings key, rendered from the manifest's schema by the same
  // shapes the app's own settings use - given a value and an onChange rather
  // than the app's Config (spec §1.5).
  for (const field of plugin.schema) {
    block.append(settingRow(plugin, field, handlers))
  }

  const state = states.get(plugin.name)
  if (state?.disabled === true) {
    // A judgement about somebody's code should not be cleared by a person who
    // does not know what it did - so tell them what it was (spec §1.2).
    const reason = state.reason ?? 'it behaved badly'
    block.append(el('div', 'plugin-problem', `Put away for this session: ${reason}. Restart the app to try it again.`))
  }

  return block
}

/**
 * @param {Installed} plugin
 * @param {import('../core/settingsSchema.js').SettingsField} field
 * @param {SettingsHandlers} handlers
 * @returns {HTMLElement}
 */
function settingRow(plugin, field, handlers) {
  const line = el('label', `setting setting-${field.kind}`)
  const held = plugin.settings.get(field.key)

  /** @param {string|number|boolean} value */
  const write = (value) => handlers.onPlugin(plugin.name, {
    enabled: plugin.enabled,
    approvedSlots: plugin.approvedSlots,
    approvedCapabilities: plugin.approved,
    approvedOpen: plugin.approvedOpen,
    approvedRun: plugin.approvedRun,
    settings: new Map([...plugin.settings, [field.key, value]]),
  })

  if (field.kind === 'switch') {
    const box = el('input', 'setting-box')
    box.setAttribute('type', 'checkbox')
    if (box instanceof HTMLInputElement) box.checked = held === true
    box.addEventListener('change', () => {
      if (box instanceof HTMLInputElement) write(box.checked)
    })
    line.append(box, el('span', 'setting-label', field.label))
    return line
  }

  line.append(el('span', 'setting-label', field.label))
  const input = el('input', 'setting-field')
  input.setAttribute('type', field.kind === 'count' ? 'number' : 'text')
  if (field.kind === 'count') input.setAttribute('min', '0')
  if (field.hint !== null) input.setAttribute('placeholder', field.hint)
  if (input instanceof HTMLInputElement) input.value = held === undefined ? '' : String(held)

  // `change`, not `input`: every one of these writes config.toml and restarts
  // the plugin, and doing that per keystroke would restart it eight times
  // while a word is typed.
  input.addEventListener('change', () => {
    if (!(input instanceof HTMLInputElement)) return
    if (field.kind !== 'count') {
      write(input.value)
      return
    }
    const count = Number(input.value)
    // Put back rather than written: a value the reader would refuse anyway is
    // a notice nobody asked for.
    if (!Number.isInteger(count) || count < 0) {
      input.value = held === undefined ? '' : String(held)
      return
    }
    write(count)
  })

  line.append(input)
  return line
}

/**
 * @param {string[]} list
 * @param {string} one
 * @param {boolean} on
 * @returns {string[]}
 */
function toggled(list, one, on) {
  return on ? [...list, one] : list.filter((held) => held !== one)
}
