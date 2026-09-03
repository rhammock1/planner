// @ts-check

/**
 * `⌘,`: the settings, and which plugins may reach what (spec §3.6, §7).
 *
 * `config.toml` is still the file, and this pane still writes it - comments,
 * alignment and all. What it adds is that a permission granted months ago is
 * one you can see without opening a text editor, which is the whole reason a
 * plugin's reach needs a surface at all.
 *
 * Every change is written the moment it is made. There is no Save button, for
 * the same reason there is not one on the day page: the file is the state.
 */

import { el } from '../ui/dom.js'
import { FIELDS } from './settingsFields.js'

/** @typedef {import('../core/config.js').Config} Config */
/** @typedef {import('../core/plugins.js').Installed} Installed */

/**
 * @typedef {object} SettingsHandlers
 * @property {(patch: Partial<Omit<Config, 'plugins'>>) => void} onChange
 * @property {(name: string, settings: import('../core/config.js').PluginConfig) => void} onPlugin
 * @property {() => void} onChooseVault
 */

/**
 * @param {SettingsHandlers} handlers
 * @returns {{element: HTMLElement, open: () => void, close: () => void, isOpen: () => boolean, render: (config: Config, plugins: Installed[]) => void}}
 */
export function createSettingsPanel(handlers) {
  const head = el('div', 'settings-head', 'Settings')
  const close = el('button', 'settings-close', 'Done')
  close.setAttribute('type', 'button')
  head.append(close)

  const body = el('div', 'settings-body')
  const element = el('div', 'settings')
  element.hidden = true
  element.append(head, body)

  close.addEventListener('click', () => { element.hidden = true })

  // Escape belongs to the pane while the pane is up, the way it does for the
  // search: the day underneath would otherwise close the whole popover.
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    element.hidden = true
  })

  return {
    element,
    isOpen: () => !element.hidden,
    open: () => { element.hidden = false },
    close: () => { element.hidden = true },
    render: (config, plugins) => {
      // Rebuilt whole. It is a short form, it is only on screen while it is
      // being read, and a half-patched form is worse than a redrawn one.
      body.replaceChildren(
        ...FIELDS.map((field) => row(field, config, handlers)),
        ...pluginRows(plugins, handlers),
      )
    },
  }
}

/**
 * @param {import('./settingsFields.js').Field} field
 * @param {Config} config
 * @param {SettingsHandlers} handlers
 * @returns {HTMLElement}
 */
function row(field, config, handlers) {
  const line = el('label', `setting setting-${field.kind}`)
  line.append(el('span', 'setting-label', field.label))

  const value = config[field.name]
  if (field.kind === 'switch') {
    const box = el('input', 'setting-box')
    box.setAttribute('type', 'checkbox')
    if (box instanceof HTMLInputElement) box.checked = value === true
    box.addEventListener('change', () => {
      if (box instanceof HTMLInputElement) handlers.onChange({ [field.name]: box.checked })
    })
    line.prepend(box)
    return line
  }

  const input = el('input', 'setting-field')
  input.setAttribute('type', field.kind === 'days' ? 'number' : 'text')
  if (field.kind === 'days') input.setAttribute('min', '0')
  if (field.hint !== undefined) input.setAttribute('placeholder', field.hint)
  if (input instanceof HTMLInputElement) input.value = String(value)

  // `change`, not `input`: a file is written on every one of these, and
  // writing eight times while a word is typed would be eight reopenings of
  // the whole config.
  input.addEventListener('change', () => {
    if (!(input instanceof HTMLInputElement)) return
    if (field.kind !== 'days') {
      handlers.onChange({ [field.name]: input.value })
      return
    }
    const days = Number(input.value)
    // Put back rather than written: a config with a negative lead time is one
    // the reader would refuse anyway, with a notice nobody asked for.
    if (!Number.isInteger(days) || days < 0) {
      input.value = String(value)
      return
    }
    handlers.onChange({ [field.name]: days })
  })

  line.append(input)
  if (field.kind === 'path') {
    const pick = el('button', 'setting-pick', 'Choose…')
    pick.setAttribute('type', 'button')
    pick.addEventListener('click', () => handlers.onChooseVault())
    line.append(pick)
  }
  return line
}

/**
 * @param {Installed[]} plugins
 * @param {SettingsHandlers} handlers
 * @returns {HTMLElement[]}
 */
function pluginRows(plugins, handlers) {
  const heading = el('div', 'settings-heading', 'Plugins')
  if (plugins.length === 0) {
    const empty = el('div', 'settings-empty', 'Nothing in ~/.planner/plugins yet.')
    return [heading, empty]
  }
  return [heading, ...plugins.map((plugin) => pluginRow(plugin, handlers))]
}

/**
 * @param {Installed} plugin
 * @param {SettingsHandlers} handlers
 * @returns {HTMLElement}
 */
function pluginRow(plugin, handlers) {
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
      })
    }
  })
  line.append(box, el('span', 'setting-label', plugin.name))
  block.append(line)

  if (plugin.problem !== null) {
    block.append(el('div', 'plugin-problem', plugin.problem))
    return block
  }

  // What it asks for, one line each, so granting is a decision per capability
  // rather than a single yes to a list you did not read (spec §7.4).
  for (const capability of plugin.asked) {
    const allow = el('label', 'capability')
    const box = el('input', 'setting-box')
    box.setAttribute('type', 'checkbox')
    if (box instanceof HTMLInputElement) box.checked = plugin.approved.includes(capability)
    box.addEventListener('change', () => {
      if (!(box instanceof HTMLInputElement)) return
      const approved = box.checked
        ? [...plugin.approved, capability]
        : plugin.approved.filter((one) => one !== capability)
      handlers.onPlugin(plugin.name, {
        enabled: plugin.enabled,
        approvedSlots: plugin.approvedSlots,
        approvedCapabilities: approved,
        approvedOpen: plugin.approvedOpen,
      })
    })
    allow.append(box, el('span', 'capability-name', capability))
    block.append(allow)
  }

  // Worth saying out loud: a plugin that asks for nothing is not a plugin
  // that was refused everything.
  if (plugin.asked.length === 0) {
    block.append(el('div', 'plugin-note', 'Asks for nothing.'))
  }
  return block
}
