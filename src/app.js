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
import { readContributions } from './core/contributions.js'
import { badgesFor, openBadge } from './plugins/pageAsking.js'
import { openInEditor, pickVault } from './vaultActions.js'
import { search } from './core/search.js'
import { installed } from './core/plugins.js'
import { today } from './clock.js'
import { createShowing } from './showing.js'
import { createStore } from './store.js'
import { createPageEdits } from './pageEdits.js'
import { createAmbient } from './ambient.js'
import * as ipc from './ipc.js'
import * as dayPage from './views/dayPage.js'
import * as startup from './startup.js'

const store = createStore()
// The day on screen. Not a `let` set at launch: this window outlives the day
// it opened on, and the page has to follow the clock over midnight
// (showing.js).
const showing = createShowing(today())
let pinned = false
const edits = createPageEdits(store, () => showing.page())
// What the app says while nobody is looking at it: the menu bar icon, and
// the alarms it hands the shell (spec §5.8, §5.9).
const ambient = createAmbient(store)

async function start() {
  const root = document.querySelector('#app')
  if (!(root instanceof HTMLElement)) throw new Error('no #app element to mount into')

  dayPage.mount(root, {
    ...edits,
    onNavigate: (page) => {
      showing.go(page, today())
      draw()
    },
    onCarry: (decisions) => { void carry(decisions) },
    onBadge: (plugin, href) => { void openBadge(store, plugin, href) },
    onPin: (next) => { void pin(next) },
    onOpenSpread: (view) => { void openSpread(view) },
    onSearch: (query) => search(store.vault(), query),
    settings: {
      onChange: (patch) => { void write(() => store.saveConfig(patch)) },
      onPlugin: (name, plugin) => { void write(() => store.savePlugin(name, plugin)) },
      onChooseVault: () => { void pickVault(store, ipc) },
    },
    onJump: (hit) => {
      // The day it is on, and then out of the way: what you were looking for
      // is a line on a page, not a row in a list of results (spec §5.7).
      showing.go(hit.page, today())
      dayPage.search().close()
      draw()
    },
  })
  dayPage.setPinned(pinned)

  document.addEventListener('keydown', (event) => {
    // The settings, where macOS keeps them (spec §3.6).
    if (event.key === ',' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      const pane = dayPage.settings()
      if (pane.isOpen()) pane.close()
      else pane.open()
      return
    }
    // Anywhere in the vault, from either surface (spec §5.7).
    if (event.key === 'f' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      const panel = dayPage.search()
      if (panel.isOpen()) panel.close()
      else panel.open()
      return
    }
    // Escape puts the day away (spec §5.1) - unless something on the page has
    // already used it to cancel an edit, which is the nearer meaning. The
    // search field uses it first, to close itself.
    if (event.key === 'Escape' && !event.defaultPrevented) {
      void ipc.closePopover()
      return
    }
    // The way out of one day and into the week, without reaching for the
    // footer (spec §5.1). Enter on its own finishes a line, so this is the
    // one place the modifier matters.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void openSpread('week')
    }
    // The way out of the app entirely: the page as a file, in your own editor
    // (spec §8). The vault is Markdown so that this is always possible.
    if (event.key === 'e' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void openInEditor(store, ipc, showing.page())
    }
  })

  await store.start(draw)
  draw()

  // After the page is up, never before it. A plugin is somebody else's code
  // and the day does not wait on it (addendum §4).
  void store.syncPlugins()

  // Every quarter of an hour, and after anything rings - which is also how
  // midnight is noticed: today's alarms have gone and tomorrow's have not (spec §5.9).
  try {
    await ipc.onScheduleRefresh(() => { store.refreshPlugins(); draw() })
  } catch (error) {
    store.notice(`Reminders will stop after today: ${message(error)}`)
  }

  try {
    // Opening the page is asking what today looks like, not what launch said.
    await ipc.onPopoverShown(() => { store.refreshPlugins(); draw() })
  } catch (error) {
    // Not fatal: the day still shows what the plugins said at launch.
    store.notice(`Plugins will not refresh when the page opens: ${message(error)}`)
  }

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
  // Before anything is read off it: the day may have turned since the last
  // draw, and if this is today's page it is now a different one.
  showing.tick(now)
  const page = showing.page()
  // One reading of the two files per draw, shared by the pane's ticks and the
  // day's headings - so a plugin cannot be called one thing in one place and
  // something else in the other.
  const plugins = installed(store.folders(), store.config().plugins)

  // Today's page only, and asked again with a fresh key on every refresh
  // (spec §1.4).
  const key = `${now}:${now}:${store.pluginGeneration()}`
  const given = page === now
    ? readContributions(
        store.pluginAnswers('vault.contribute', key, { from: now, to: now }),
        page,
        new Map(plugins.map((one) => [one.name, one.heading])),
      )
    : { sections: [], notices: [] }

  // What the plugins have to say about the lines on this page (spec §1.4).
  const marked = badgesFor(store, page)

  ambient.update(now)

  // Drawn whenever the day is, so a setting changed here and a setting
  // changed in a text editor both show up the same way.
  dayPage.settings().render(
    store.config(),
    plugins,
    new Map(store.pluginStates().map((state) => [state.name, state])),
  )

  dayPage.render({
    today: now,
    page,
    doc: store.page(page),
    horizon: horizon(store.vault(), now, store.config().horizonLeadDays),
    // Carry-forward is about arriving at today. Looking back at last Tuesday
    // is reading, not triage, so the band stays out of the way there.
    carry: page === now ? unfinished(store.vault(), now, store.config().carryForwardScanDays) : [],
    sections: given.sections,
    badges: marked.badges,
    // The one thing a notice ever needs pressing for: the app will not put a
    // vault somewhere nobody asked for (spec §8).
    actions: store.vaultExists() ? [] : [{ label: 'Choose a folder…', run: () => { void pickVault(store, ipc) } }],
    // Worked out on the way to the page rather than kept, so redrawing the
    // same contributions does not say the same thing twice.
    notices: [...store.notices(), ...given.notices, ...marked.notices],
  })
}

/**
 * Runs a write to `config.toml` and says so if it will not go.
 *
 * @param {() => Promise<void>} change
 * @returns {Promise<void>}
 */
async function write(change) {
  try {
    await change()
  } catch (error) {
    store.notice(`Could not save that setting: ${message(error)}`)
  }
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
