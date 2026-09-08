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
import { applyPluginTokens } from './plugins/theming.js'
import { moveItem } from './core/move.js'
import { search } from './core/search.js'
import { badgesFor, openBadge } from './plugins/pageAsking.js'
import { weekOf } from './core/calendar.js'
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
    onBadge: (plugin, href) => { void openBadge(store, plugin, href) },
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

  // The same fifteen-minute wake the popover hears, for the same reason: it
  // is what moves a plugin's generation, and this window asks plugins too
  // (spec §1.4). Not fatal - the window still shows what they said when it
  // was opened.
  try {
    await ipc.onScheduleRefresh(() => { store.refreshPlugins(); draw() })
  } catch (error) {
    store.notice(`Plugins will not follow the clock in this window: ${message(error)}`)
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
  // What the plugins have to say about every page a line can be drawn on:
  // the week's seven columns and the back page (spec §2.1). Asked for the
  // week even when another view is on screen - cheap, cache-only reads, so
  // switching tabs never waits on a fresh round trip.
  /** @type {Map<string, Map<number, import('./core/badges.js').Badge[]>>} */
  const badges = new Map()
  /** @type {string[]} */
  const badgeNotices = []
  for (const page of [...weekOf(anchor), SOMEDAY]) {
    const marked = badgesFor(store, page)
    badges.set(page, marked.badges)
    badgeNotices.push(...marked.notices)
  }

  // The colours the plugins moved, over the theme's own (spec §3.3). This
  // window asks for itself: the two windows have separate stores and never
  // talk to each other.
  const warmed = applyPluginTokens(store)

  spreadPage.render({
    view,
    today: today(),
    anchor,
    vault: store.vault(),
    badges,
    notices: [...store.notices(), ...badgeNotices, ...warmed],
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
