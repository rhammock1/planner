// @ts-check

/**
 * Quick add: one field, wherever you are (spec §5.2).
 *
 * The preview under the field is not decoration. It is the thing that makes
 * natural-language parsing safe to use - the reading is shown before it is
 * committed, so `at 4` meaning the afternoon is a choice you can see rather
 * than a surprise you find later.
 */

import { el, setText } from '../ui/dom.js'

/** @typedef {import('../core/nldate.js').Entry} Entry */

/**
 * @typedef {object} QuickAddHandlers
 * @property {(line: string) => {entry: Entry, preview: string}} onType
 * @property {(line: string) => Promise<boolean>} onCommit
 * @property {() => void} onDismiss
 */

/**
 * @param {HTMLElement} root
 * @param {QuickAddHandlers} handlers
 * @returns {{focus: () => void}}
 */
export function mount(root, handlers) {
  const field = document.createElement('input')
  field.className = 'quick-field'
  field.placeholder = 'What needs doing?'
  field.setAttribute('aria-label', 'What needs doing?')
  field.autocapitalize = 'off'
  field.spellcheck = false

  const preview = el('div', 'quick-preview')
  const surface = el('div', 'quick')
  surface.append(field, preview)
  root.replaceChildren(surface)

  const show = () => {
    const { preview: text } = handlers.onType(field.value)
    setText(preview, text)
    preview.hidden = text === ''
  }

  field.addEventListener('input', show)

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      field.value = ''
      show()
      handlers.onDismiss()
      return
    }
    if (event.key !== 'Enter' || field.value.trim() === '') return

    const line = field.value
    handlers.onCommit(line).then((saved) => {
      if (!saved) return
      // Cleared only once it has landed, so a refused write leaves the line
      // where it can be tried again (spec §8).
      field.value = ''
      show()
      handlers.onDismiss()
    })
  })

  show()
  return { focus: () => field.focus() }
}
