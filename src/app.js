// @ts-check

/**
 * The popover: load the vault, render the day, and re-render whatever the
 * watcher says changed.
 *
 * This module holds the only mutable state in the frontend - the current
 * page and the parsed vault - and it holds it in exactly one place, because
 * every change arrives the same way: from disk (spec §4.1).
 */

import { parse } from './core/parse.js'
import { buildIndex, getPage, withPage } from './core/vaultIndex.js'
import { horizon } from './core/horizon.js'
import { readConfig as parseConfig, DEFAULTS } from './core/config.js'
import { readTheme as parseTheme, themeCss, LEDGER } from './core/theme.js'
import { today } from './clock.js'
import * as ipc from './ipc.js'
import * as dayPage from './views/dayPage.js'

/** @typedef {import('./core/vaultIndex.js').VaultIndex} VaultIndex */

/** @type {VaultIndex} */
let vault = buildIndex([])
/** @type {import('./core/config.js').Config} */
let config = DEFAULTS
/** @type {string[]} */
let notices = []
let showing = today()

async function start() {
  const root = document.querySelector('#app')
  if (!(root instanceof HTMLElement)) throw new Error('no #app element to mount into')

  config = await loadConfig()
  await applyTheme(config.theme)

  dayPage.mount(root, {
    onNavigate: (page) => {
      showing = page
      draw()
    },
  })

  const files = await ipc.readVault()
  vault = buildIndex(files.map((file) => ({ page: file.page, doc: parse(file.text) })))
  draw()

  // One subscription, for every change: this app's writes and an edit made in
  // nvim arrive here by the same path.
  await ipc.onVaultChanged(async (page) => {
    const text = await ipc.readPage(page)
    vault = withPage(vault, page, text === null ? null : parse(text))
    draw()
  })
}

function draw() {
  dayPage.render({
    today: today(),
    page: showing,
    doc: getPage(vault, showing),
    horizon: horizon(vault, today(), config.horizonLeadDays),
    notices,
  })
}

/** @returns {Promise<import('./core/config.js').Config>} */
async function loadConfig() {
  const result = parseConfig(await ipc.readConfig())
  notices = [...notices, ...result.notices]
  return result.config
}

/**
 * Tokens first, then the theme's own stylesheet, both after the app's CSS so
 * a theme can override anything it sets.
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
async function applyTheme(name) {
  const folder = await ipc.readTheme(name)
  const result = folder.toml === '' ? { theme: LEDGER, notices: [] } : parseTheme(folder.toml)
  notices = [...notices, ...result.notices]

  styleElement('theme-tokens').textContent = themeCss(result.theme)
  styleElement('theme-css').textContent = folder.css
  document.documentElement.style.colorScheme = result.theme.appearance
}

/**
 * @param {string} id
 * @returns {HTMLStyleElement}
 */
function styleElement(id) {
  const existing = document.querySelector(`#${id}`)
  if (existing instanceof HTMLStyleElement) return existing
  const created = document.createElement('style')
  created.id = id
  document.head.append(created)
  return created
}

start().catch((error) => {
  // Never swallow an error (spec §11.8). The page is empty if this fires, so
  // it has to say why somewhere a person will look.
  document.body.textContent = `Planner could not start: ${error instanceof Error ? error.message : String(error)}`
  throw error
})
