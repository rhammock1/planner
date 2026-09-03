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
import { createPluginRows } from './pluginRows.js'

/** @typedef {import('../core/config.js').Config} Config */
/** @typedef {import('../core/plugins.js').Installed} Installed */
/** @typedef {import('../plugins/asking.js').PluginState} PluginState */

/**
 * @typedef {object} SettingsHandlers
 * @property {(patch: Partial<Omit<Config, 'plugins'>>) => void} onChange
 * @property {(name: string, settings: import('../core/config.js').PluginConfig) => void} onPlugin
 * @property {() => void} onChooseVault
 */

/**
 * @param {SettingsHandlers} handlers
 * @returns {{element: HTMLElement, open: () => void, close: () => void, isOpen: () => boolean, render: (config: Config, plugins: Installed[], states?: Map<string, PluginState>) => void}}
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
    render: (config, plugins, states = new Map()) => {
      // Rebuilt whole. It is a short form, it is only on screen while it is
      // being read, and a half-patched form is worse than a redrawn one.
      body.replaceChildren(
        ...FIELDS.map((field) => row(field, config, handlers)),
        ...createPluginRows(plugins, states, handlers),
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
