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
import { moveItem } from './core/move.js'
import { search } from './core/search.js'
import { SOMEDAY } from './core/vaultIndex.js'
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
    onMove: (from, index, to) => { void move(from, index, to) },
    onAnchor: (next) => {
      // '' is how a view says "back to now" without holding a clock itself.
      anchor = next === '' ? today() : next
      draw()
    },
    onSearch: (query) => search(store.vault(), query),
    onJump: (hit) => {
      // This window shows weeks and months, not days, so a result lands on
      // the week its day sits in - or on the back page, which is a view of
      // its own (spec §5.7).
      if (hit.page === SOMEDAY) {
        view = 'someday'
      } else {
        view = 'week'
        anchor = hit.page
      }
      spreadPage.search().close()
      draw()
    },
  })

  // The same shortcut the popover has, over the same vault (spec §5.7).
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'f' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    const panel = spreadPage.search()
    if (panel.isOpen()) panel.close()
    else panel.open()
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

/**
 * Moves a line from one page onto another (spec §5.6).
 *
 * Two pages change, and they are written in the order `moveItem` returns them
 * - the destination first - so a failure part way through can only leave the
 * line on two pages, never on none (spec §8).
 *
 * @param {string} from
 * @param {number} index  position in the source page's `doc.nodes`
 * @param {string} to
 * @returns {Promise<void>}
 */
async function move(from, index, to) {
  // Decided against the freshest state, not against the index: a line added a
  // moment ago may still be in the post.
  const fresh = store.freshest([from, to])

  /** @type {ReturnType<typeof moveItem>} */
  let writes
  try {
    writes = moveItem(fresh, from, index, to, today())
  } catch (error) {
    // The line is where it was. Say why it did not move (spec §8).
    store.notice(`Could not move that line: ${message(error)}`)
    return
  }

  for (const write of writes) {
    if (!await store.change(write.page, () => write.doc)) return
  }
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
