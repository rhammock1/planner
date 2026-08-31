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
import { serialize } from './core/serialize.js'
import { createDayDocument, createItem } from './core/model.js'
import { setItemState, setItemText, appendItem } from './core/edit.js'
import { buildIndex, getPage, withPage } from './core/vaultIndex.js'
import { horizon } from './core/horizon.js'
import { unfinished, carryForward } from './core/carry.js'
import { readConfig as parseConfig, DEFAULTS, expandHome } from './core/config.js'
import { readTheme as parseTheme, themeCss, LEDGER } from './core/theme.js'
import { today } from './clock.js'
import { createWriteQueue } from './writeQueue.js'
import * as ipc from './ipc.js'
import * as dayPage from './views/dayPage.js'

/** @typedef {import('./core/vaultIndex.js').VaultIndex} VaultIndex */
/** @typedef {import('./core/model.js').Document} Document */

// One change at a time, and nothing reads a page it has just written but not
// yet seen come back (see writeQueue.js).
const writes = createWriteQueue(async (page, doc) => { await ipc.writePage(page, serialize(doc)) })

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
  await openVault()

  dayPage.mount(root, {
    onNavigate: (page) => {
      showing = page
      draw()
    },
    onToggle: (index) => { void toggle(index) },
    onEdit: (index, text) => edit(index, text),
    onAdd: (line) => add(line),
    onCarry: (decisions) => { void carry(decisions) },
  })

  const files = await ipc.readVault()
  vault = buildIndex(files.map((file) => ({ page: file.page, doc: parse(file.text) })))
  draw()

  // One subscription, for every change: this app's writes and an edit made in
  // nvim arrive here by the same path.
  await ipc.onVaultChanged(async (page) => {
    const text = await ipc.readPage(page)
    vault = withPage(vault, page, text === null ? null : parse(text))
    // Whatever we may have written to this page has now arrived, so the file
    // is the only thing worth believing about it.
    writes.observed(page)
    draw()
  })
}

function draw() {
  const now = today()
  dayPage.render({
    today: now,
    page: showing,
    doc: getPage(vault, showing),
    horizon: horizon(vault, now, config.horizonLeadDays),
    // Carry-forward is about arriving at today. Looking back at last Tuesday
    // is reading, not triage, so the band stays out of the way there.
    carry: showing === now ? unfinished(vault, now, config.carryForwardScanDays) : [],
    notices,
  })
}

/**
 * Open becomes done and done becomes open. Migrated and dropped lines are
 * historical record; clicking one brings it back as done rather than
 * pretending it was never settled.
 *
 * @param {number} index position in the page's doc.nodes
 * @returns {Promise<boolean>}
 */
function toggle(index) {
  return change(showing, (doc) => {
    const node = doc?.nodes[index]
    if (doc === null || node === undefined || node.kind !== 'item') return null
    return setItemState(doc, index, node.state === 'done' ? 'open' : 'done')
  })
}

/**
 * @param {number} index position in the page's doc.nodes
 * @param {string} text
 * @returns {Promise<boolean>} false when nothing was written
 */
function edit(index, text) {
  return change(showing, (doc) => {
    const node = doc?.nodes[index]
    if (doc === null || node === undefined || node.kind !== 'item') return null
    return setItemText(doc, index, text)
  })
}

/**
 * The line is stored as typed. Any `@time` or `!due` in it is extracted when
 * the file is read back, which is the same path a line typed in nvim takes -
 * so there is one parser, used once, and no second implementation here.
 *
 * Natural-language dates belong to quick add, where a preview makes the
 * reading visible before it is committed (spec §5.2). A line typed here means
 * what it says.
 *
 * @param {string} line
 * @returns {Promise<boolean>} false when nothing was written
 */
function add(line) {
  const text = line.trim()
  if (text === '') return Promise.resolve(false)
  return change(showing, (doc) => appendItem(doc ?? createDayDocument(showing), createItem(text)))
}

/**
 * Keeps or drops unfinished items from earlier days.
 *
 * The writes are applied in the order carryForward returns them - today
 * first - so a failure part way through can only leave an item on two pages,
 * never on none (spec §8).
 *
 * @param {import('./core/carry.js').CarryDecision[]} decisions
 * @returns {Promise<void>}
 */
async function carry(decisions) {
  if (decisions.length === 0) return

  // Decided against the freshest state, not against the index: an item added
  // a moment ago may still be in the post.
  const now = today()
  const touched = new Set([now, ...decisions.map((decision) => decision.page)])
  let fresh = vault
  for (const page of touched) {
    fresh = withPage(fresh, page, writes.current(page, () => getPage(vault, page)))
  }

  for (const write of carryForward(fresh, now, decisions)) {
    if (!await change(write.page, () => write.doc)) return
  }
}

/**
 * The one place a document leaves the app. Nothing else writes.
 *
 * @param {string} page
 * @param {(doc: Document|null) => Document|null} mutate  null writes nothing
 * @returns {Promise<boolean>}
 */
async function change(page, mutate) {
  try {
    return await writes.change(page, () => getPage(vault, page), mutate)
  } catch (error) {
    // The atomic write means the file on disk is untouched. Say so, and leave
    // what the user typed where it is (spec §8).
    notices = [...notices, `Could not save ${page}: ${error instanceof Error ? error.message : String(error)}`]
    draw()
    return false
  }
}

/** @type {string} */
let home = ''

/** @returns {Promise<import('./core/config.js').Config>} */
async function loadConfig() {
  const file = await ipc.readConfig()
  home = file.home
  const result = parseConfig(file.text)
  notices = [...notices, ...result.notices]
  return result.config
}

/**
 * Points the shell at the vault and starts the watcher on it.
 *
 * A vault that is not there is reported rather than created: the app does not
 * put a folder somewhere the user did not ask for (spec §8).
 *
 * @returns {Promise<void>}
 */
async function openVault() {
  const path = expandHome(config.vault, home)
  const { exists } = await ipc.setVault(path)
  if (!exists) {
    notices = [...notices, `No vault at ${path}. Create the folder, or set another path in config.toml.`]
  }
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
