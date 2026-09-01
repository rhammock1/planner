// @ts-check

/**
 * The popover: load the vault, render the day, and re-render whatever the
 * watcher says changed.
 *
 * What is on screen is a function of the store and the day being shown. The
 * store holds the vault and owns the write path (store.js); the gestures a
 * list answers are in pageEdits.js, shared with the back page. What is left
 * here is what only the day has: navigation, carry-forward, and the pin.
 */

import { horizon } from './core/horizon.js'
import { unfinished, carryForward } from './core/carry.js'
import { today } from './clock.js'
import { createStore } from './store.js'
import { createPageEdits } from './pageEdits.js'
import * as ipc from './ipc.js'
import * as dayPage from './views/dayPage.js'
import * as startup from './startup.js'

const store = createStore()
let showing = today()
let pinned = false
const edits = createPageEdits(store, () => showing)

async function start() {
  const root = document.querySelector('#app')
  if (!(root instanceof HTMLElement)) throw new Error('no #app element to mount into')

  dayPage.mount(root, {
    ...edits,
    onNavigate: (page) => {
      showing = page
      draw()
    },
    onCarry: (decisions) => { void carry(decisions) },
    onPin: (next) => { void pin(next) },
    onOpenSpread: (view) => { void openSpread(view) },
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
    store.notice(`Could not ${next ? 'pin' : 'unpin'} the page: ${message(error)}`)
  }
}

/**
 * Opens the detached window on one of its views (spec §5.6). The popover only
 * ever shows a day; everything wider than one lives in the other window.
 *
 * @param {string} view
 * @returns {Promise<void>}
 */
async function openSpread(view) {
  try {
    await ipc.openSpread(view)
  } catch (error) {
    store.notice(`Could not open the ${view} view: ${message(error)}`)
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
  const fresh = store.freshest([now, ...decisions.map((decision) => decision.page)])

  for (const write of carryForward(fresh, now, decisions)) {
    if (!await store.change(write.page, () => write.doc)) return
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}

start().catch((error) => {
  // Never swallow an error (spec §11.8). The page is empty if this fires, so
  // it has to say why somewhere a person will look.
  document.body.textContent = `Planner could not start: ${message(error)}`
  throw error
})
