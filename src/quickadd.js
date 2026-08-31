// @ts-check

/**
 * The quick-add window.
 *
 * It holds no vault of its own: it reads the one page it is about to write,
 * appends to it, and hands it back. Everything else about the vault is the
 * popover's business, and it will hear about this write from the watcher like
 * any other (spec §4.1).
 */

import { parse } from './core/parse.js'
import { serialize } from './core/serialize.js'
import { createDayDocument, createItem } from './core/model.js'
import { appendItem } from './core/edit.js'
import { parseEntry } from './core/nldate.js'
import { readConfig as parseConfig } from './core/config.js'
import { readTheme as parseTheme, themeCss, LEDGER } from './core/theme.js'
import { expandHome } from './core/config.js'
import { today } from './clock.js'
import { describeEntry } from './views/entryPreview.js'
import * as ipc from './ipc.js'
import * as quickAdd from './views/quickAdd.js'

async function start() {
  const root = document.querySelector('#app')
  if (!(root instanceof HTMLElement)) throw new Error('no #app element to mount into')

  const file = await ipc.readConfig()
  const { config } = parseConfig(file.text)
  await applyTheme(config.theme)
  await ipc.setVault(expandHome(config.vault, file.home))

  const view = quickAdd.mount(root, {
    onType: (line) => {
      const entry = parseEntry(line, today())
      return { entry, preview: describeEntry(entry, today()) }
    },
    onCommit: (line) => commit(line),
    onDismiss: () => { void ipc.closeQuickAdd() },
  })

  view.focus()
  // The window is shown again rather than rebuilt, so the field has to be
  // ready every time it comes back, not only the first time.
  window.addEventListener('focus', () => view.focus())
}

/**
 * Writes the line to the day it names, or to today if it names none.
 *
 * @param {string} line
 * @returns {Promise<boolean>}
 */
async function commit(line) {
  const entry = parseEntry(line, today())
  const text = entry.text.trim()
  if (text === '') return false

  const page = entry.date ?? today()
  try {
    const existing = await ipc.readPage(page)
    const doc = existing === null ? createDayDocument(page) : parse(existing)
    const item = createItem(text, { time: entry.time, due: entry.due })
    await ipc.writePage(page, serialize(appendItem(doc, item)))
    return true
  } catch (error) {
    // Nowhere to put a notice in a one-field window, and the line is still in
    // the field, so the console is where this goes rather than nowhere.
    console.error('planner: could not save the line', error)
    return false
  }
}

/**
 * @param {string} name
 * @returns {Promise<void>}
 */
async function applyTheme(name) {
  const folder = await ipc.readTheme(name)
  const { theme } = folder.toml === '' ? { theme: LEDGER } : parseTheme(folder.toml)

  const tokens = document.createElement('style')
  tokens.textContent = themeCss(theme)
  const own = document.createElement('style')
  own.textContent = folder.css
  document.head.append(tokens, own)
  document.documentElement.style.colorScheme = theme.appearance
}

start().catch((error) => {
  document.body.textContent = `Quick add could not start: ${error instanceof Error ? error.message : String(error)}`
  throw error
})
