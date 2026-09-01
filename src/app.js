// @ts-check

/**
 * The popover: load the vault, render the day, and re-render whatever the
 * watcher says changed.
 *
 * What is on screen is a function of the store and the day being shown. The
 * store holds the vault and owns the write path (store.js); this module is
 * the day's handlers and nothing else.
 */

import { createDayDocument, createItem } from './core/model.js'
import {
  setItemState, setItemText, setItemNote, removeItem, carriesNothingElse, appendItem, setDailyNote,
} from './core/edit.js'
import { horizon } from './core/horizon.js'
import { unfinished, carryForward } from './core/carry.js'
import { today } from './clock.js'
import { createStore } from './store.js'
import * as ipc from './ipc.js'
import * as dayPage from './views/dayPage.js'
import * as startup from './startup.js'

/** @typedef {import('./core/model.js').Document} Document */

const store = createStore()
let showing = today()
let pinned = false

async function start() {
  const root = document.querySelector('#app')
  if (!(root instanceof HTMLElement)) throw new Error('no #app element to mount into')

  dayPage.mount(root, {
    onNavigate: (page) => {
      showing = page
      draw()
    },
    onToggle: (index) => { void toggle(index) },
    onEdit: (index, text) => edit(index, text),
    onNote: (index, note) => annotate(index, note),
    onStrike: (index) => { void strike(index) },
    onRemove: (index) => remove(index),
    onDailyNote: (note) => dailyNote(note),
    onAdd: (line) => add(line),
    onCarry: (decisions) => { void carry(decisions) },
    onPin: (next) => { void pin(next) },
  })
  dayPage.setPinned(pinned)

  // Escape puts the day away (spec §5.1) - unless something on the page has
  // already used it to cancel an edit, which is the nearer meaning.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) void ipc.closePopover()
  })

  await store.start(draw)
  draw()

  for (const notice of await startup.registerHotkey(store.config().hotkey)) store.notice(notice)
}

/**
 * Pins the popover open, or lets go of it.
 *
 * The shell owns the behaviour - it is the shell that hides a window when it
 * loses focus - so the state is sent there and mirrored here.
 *
 * @param {boolean} next
 * @returns {Promise<void>}
 */
async function pin(next) {
  try {
    await ipc.setPinned(next)
    pinned = next
    dayPage.setPinned(pinned)
  } catch (error) {
    store.notice(`Could not ${next ? 'pin' : 'unpin'} the page: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function draw() {
  const now = today()
  dayPage.render({
    today: now,
    page: showing,
    doc: store.page(showing),
    horizon: horizon(store.vault(), now, store.config().horizonLeadDays),
    // Carry-forward is about arriving at today. Looking back at last Tuesday
    // is reading, not triage, so the band stays out of the way there.
    carry: showing === now ? unfinished(store.vault(), now, store.config().carryForwardScanDays) : [],
    notices: store.notices(),
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
  return store.change(showing, (doc) => {
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
  return store.change(showing, (doc) => {
    const node = doc?.nodes[index]
    if (doc === null || node === undefined || node.kind !== 'item') return null
    return setItemText(doc, index, text)
  })
}

/**
 * Writes the day's own line, at the bottom of the page.
 *
 * @param {string} note
 * @returns {Promise<boolean>}
 */
function dailyNote(note) {
  return store.change(showing, (doc) => (doc === null ? null : setDailyNote(doc, note.trim())))
}

/**
 * Crosses a line out, or takes an already-crossed-out one off the page.
 *
 * `[-]` is the record of a decision, and the page is kept for its records. A
 * second press is how you say the line was never worth one.
 *
 * @param {number} index
 * @returns {Promise<boolean>}
 */
function strike(index) {
  return store.change(showing, (doc) => {
    const node = doc?.nodes[index]
    if (doc === null || node === undefined || node.kind !== 'item') return null
    if (node.state === 'dropped') return removeItem(doc, index)
    return setItemState(doc, index, 'dropped')
  })
}

/**
 * Takes a line off the page because its text was rubbed out.
 *
 * Refused when the line carries a time, a deadline or a note: those are worth
 * more than the keystroke that emptied the words, and the text is put back.
 *
 * @param {number} index
 * @returns {Promise<boolean>}
 */
function remove(index) {
  const node = store.page(showing)?.nodes[index]
  if (node === undefined || node.kind !== 'item' || !carriesNothingElse(node)) return Promise.resolve(false)

  return store.change(showing, (doc) => {
    const current = doc?.nodes[index]
    if (doc === null || current === undefined || current.kind !== 'item') return null
    // Read again inside the write, in case the file moved under us.
    return carriesNothingElse(current) ? removeItem(doc, index) : null
  })
}

/**
 * Writes the line underneath an item. An empty one takes the note away.
 *
 * @param {number} index
 * @param {string} note
 * @returns {Promise<boolean>}
 */
function annotate(index, note) {
  return store.change(showing, (doc) => {
    const node = doc?.nodes[index]
    if (doc === null || node === undefined || node.kind !== 'item') return null
    return setItemNote(doc, index, note)
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
  return store.change(showing, (doc) => appendItem(doc ?? createDayDocument(showing), createItem(text)))
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

  const now = today()
  const fresh = store.freshest([now, ...decisions.map((decision) => decision.page)])

  for (const write of carryForward(fresh, now, decisions)) {
    if (!await store.change(write.page, () => write.doc)) return
  }
}

start().catch((error) => {
  // Never swallow an error (spec §11.8). The page is empty if this fires, so
  // it has to say why somewhere a person will look.
  document.body.textContent = `Planner could not start: ${error instanceof Error ? error.message : String(error)}`
  throw error
})
