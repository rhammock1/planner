// @ts-check

/**
 * The detached window (spec §5.6).
 *
 * Its own webview, so its own store: the vault is read here independently and
 * the watcher is subscribed to here independently. The two windows never talk
 * to each other. An edit made in one lands on disk, and the other hears about
 * it the same way it hears about an edit made in nvim (spec §4.1).
 */

import { today } from './clock.js'
import { createStore } from './store.js'
import { createPageEdits } from './pageEdits.js'
import * as ipc from './ipc.js'
import { VIEWS } from './views/spreadViews.js'
import * as spreadPage from './views/spreadPage.js'

const store = createStore()

/** Which view is on screen. The shell decides, from the tab that opened it. */
let view = VIEWS[0] ?? ''

/**
 * The week, or month, being looked at - as a date inside it. Shared between
 * the views, so switching from a week in October to the month view lands on
 * October rather than back on today.
 */
let anchor = today()

async function start() {
  const root = document.querySelector('#app')
  if (!(root instanceof HTMLElement)) throw new Error('no #app element to mount into')

  spreadPage.mount(root, {
    // One set of gestures per page, bound to that page. A view that shows
    // seven days asks for seven of these.
    editsFor: (pageOf) => createPageEdits(store, pageOf),
    onView: (next) => {
      view = next
      draw()
    },
    onAnchor: (next) => {
      // '' is how a view says "back to now" without holding a clock itself.
      anchor = next === '' ? today() : next
      draw()
    },
  })

  await store.start(draw)

  // Which view the window was opened on, and every later switch. Asked for
  // rather than passed in the URL, because a second click can arrive before
  // this webview has finished loading (see spread.rs).
  try {
    view = await ipc.spreadView() ?? view
    await ipc.onSpreadView((next) => {
      view = next
      draw()
    })
  } catch (error) {
    store.notice(`The footer's tabs will not switch this window: ${message(error)}`)
  }

  draw()
}

function draw() {
  spreadPage.render({
    view,
    today: today(),
    anchor,
    vault: store.vault(),
    notices: store.notices(),
  })
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}

start().catch((error) => {
  document.body.textContent = `Planner could not open this window: ${message(error)}`
  throw error
})
