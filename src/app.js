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
import { badgesFor, sectionsFor, providedFor, boxFor, boardsFor, boardPlugins } from './plugins/pageAsking.js'
import { keepBoards, dropCard } from './plugins/boardWrites.js'
import { boardViewOf, pluginOfView } from './views/boardView.js'
import { DAY_VIEW } from './views/dayFooter.js'
import { lineWithId } from './core/ids.js'
import { SOMEDAY } from './core/vaultIndex.js'
import { openInEditor, pickVault } from './vaultActions.js'
import { openSidecar, followHit, followRef, noteOnLine, openMarker } from './sidecarActions.js'
import { readRef, sidecarRef, sidecarPath } from './core/sidecars.js'
import { search } from './core/search.js'
import { applyPluginTokens, wearing } from './plugins/theming.js'
import { glanceOf } from './core/glance.js'
import { today } from './clock.js'
import { createShowing } from './showing.js'
import { createStore } from './store.js'
import { createPageEdits } from './pageEdits.js'
import { createAmbient } from './ambient.js'
import * as ipc from './ipc.js'
import * as dayPage from './views/dayPage.js'
import * as startup from './startup.js'

/** How a note's own day reads under its title. */
const STAMP = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
})

const store = createStore()
// The day on screen. Not a `let` set at launch: this window outlives the day
// it opened on, and the page has to follow the clock over midnight
// (showing.js).
const showing = createShowing(today())
// Which of this window's views is up: the day, or one plugin's board (phase
// four §8.3). A module `let` rather than anything kept, because the popover is
// hidden rather than destroyed - the webview that was on the board at five is
// the one the icon opens at six - and because what you were last looking at is
// not a thing to write to disk.
let view = DAY_VIEW
let pinned = false
// A note a jump is waiting for, until the day's files have been read again
// (spec §4.3).
/** @type {string|null} */
let revealing = null
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
    onBadge: (plugin, href) => { void openMarker(surface, plugin, href) },
    onOpenSidecar: (block) => { void openSidecar(surface, block) },
    note: {
      // The note's own id, not `showing.page()`, which has moved on by the
      // time a note opened on one day and closed on another flushes.
      onWrite: (id, text) => {
        const named = readRef(id)
        if (named === null) return Promise.resolve(false)
        return store.changeSidecar(named.date, named.suffix, text)
      },
      onDelete: (id) => {
        const named = readRef(id)
        if (named === null) return Promise.resolve(false)
        return remove(named.date, named.suffix)
      },
      onFollow: (href) => { void followRef(surface, href) },
      onOpenLink: (url) => { void openLink(url) },
      onClose: () => { closeNote() },
    },
    onPin: (next) => { void pin(next) },
    onView: (next) => { go(next) },
    onCard: (plugin, id, column, before) => { void dropCard(store, plugin, id, column, before) },

    /**
     * A card dropped on the last column, which is not a drop target: a card
     * gets there by its line being ticked, and ticking a line is a write into
     * your day file that a board does not make (kanban design §6).
     *
     * The refusal does the useful half, and this window can do it properly
     * where the spread window can only get close: it shows the day the line is
     * on, with the line's own checkbox one click away. A line on the back page
     * is the exception - that is the other window's view - so that one is
     * handed over the way it always was.
     */
    onFinish: (id) => {
      const found = lineWithId(store.vault(), id)
      if (found === null) {
        // A card whose task is nowhere in the vault. Said out loud, because
        // unlike a stale drawing this one does not fix itself: the card will
        // sit on the board being undroppable until somebody knows why.
        store.notice('That card’s line is not in the vault, so there is nothing to tick.')
        return
      }
      if (found.page === SOMEDAY) {
        void openSpread('someday')
        return
      }
      showing.go(found.page, today())
      view = DAY_VIEW
      draw()
    },
    onSearch: (query) => search(store.vault(), query),
    onProviders: (query) => providedFor(store, query),
    onFollow: (hit) => { void followHit(surface, hit) },
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
      // Whatever is half-typed goes to disk now, before the window's own timers go idle (spec §3.1).
      void dayPage.noteView().flush().finally(() => ipc.closePopover())
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
    // A page of your own about the line you are on (spec §4.3). Shift is what
    // keeps it off ⌘N, which belongs to a new window everywhere on this
    // platform. `key` is uppercase while Shift is held, so it is lowercased
    // rather than compared to 'n' and silently never matching.
    if (event.key.toLowerCase() === 'n' && event.shiftKey && (event.metaKey || event.ctrlKey)) {
      const line = dayPage.focusedLine()
      // Nothing is prevented when no line has the caret: the chord meant
      // nothing here, and swallowing it would swallow it from whatever it
      // might mean to the field that does have focus.
      if (line === null) return
      event.preventDefault()
      void noteOnLine(surface, line)
      return
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

  // Last, and after the first `draw()`: this is the page telling the shell it
  // is worth showing, and `planner` typed with no path is what was waiting to
  // hear it (spec §1.1). Not fatal - the menu bar icon still opens the page.
  try {
    await ipc.popoverReady()
  } catch (error) {
    store.notice(`Could not tell the shell this page is ready: ${message(error)}`)
  }
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
 * A tab in the footer.
 *
 * Two kinds of destination in one strip (phase four §8.3). The day and a
 * board are views of this window; the week, the month and the back page are
 * the other window's, because they show more than one day and this one is 380
 * points wide. Which is which is decided here rather than in the footer, so
 * the strip stays a strip of names.
 *
 * @param {string} next
 * @returns {void}
 */
function go(next) {
  if (next !== DAY_VIEW && pluginOfView(next) === null) {
    void openSpread(next)
    return
  }

  // A board is an arrangement of today and only today (`.plan/spec.md`), and
  // this window, unlike the other one, has a date at the top of it. Opening a
  // board while the page shows last Tuesday would put Tuesday's date above an
  // arrangement of today - so the page comes with you. Going back to the day
  // then leaves you on today, which is where somebody who has just read
  // today's board wants to be.
  if (pluginOfView(next) !== null) showing.go(today(), today())
  view = next
  draw()
}

/**
 * Opens the detached window on one of its views (spec §5.6).
 *
 * @param {string} asked
 * @returns {Promise<void>}
 */
async function openSpread(asked) {
  try {
    await ipc.openSpread(asked)
  } catch (error) {
    store.notice(`Could not open the ${asked} view: ${message(error)}`)
  }
}

function draw() {
  // The day this draw is about, settled once. `today()` read twice in one draw
  // can straddle midnight, and a board's writes decided against one of them
  // and written into the page named by the other is an id stamped on the wrong
  // day - the same rule `spread.js` follows, for the same reason.
  const now = today()
  // Before anything is read off it: the day may have turned since the last
  // draw, and if this is today's page it is now a different one.
  showing.tick(now)
  const page = showing.page()
  // One reading of the two files, shared by the pane's ticks and the day's
  // headings - so a plugin cannot be called one thing in one place and
  // something else in the other. The store memoizes it, so this costs a
  // manifest parse only when one of the two files has actually changed.
  const plugins = store.installed()

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

  // The blocks under the day, whichever day: Friday's notes live on Friday.
  const blocked = sectionsFor(store, page)

  // The colours the plugins moved, over the theme's own (spec §3.3). It also
  // keeps the minute clock that lets a pinned page follow the sky.
  const warmed = applyPluginTokens(store, draw)

  // The day's margin, after the colours have settled: a picture is handed what
  // the window is wearing, and a draw that asked before `applyPluginTokens`
  // would hand it the theme's own for one frame and a plugin's for the next
  // (phase four §1.1).
  //
  // Not asked for at all in a window too short to show one - which is the
  // whole of the threshold rule: a question nobody can see the answer to is
  // not a question worth waking a plugin for.
  // Which plugins have a board, which is a question for the config rather
  // than for any plugin: a tab exists because a manifest says so, so the strip
  // is drawn whether or not anybody has been asked anything.
  const tabs = boardPlugins(store).map((one) => ({ plugin: one.name, tab: one.tab }))

  // The board itself, asked about today and only while one is on screen. The
  // same threshold rule the margin below follows: a question nobody can see
  // the answer to is not worth waking a plugin for.
  //
  // The window asks too, and both windows write. Two of the three writes are
  // already safe to make twice - `mergeBoard` returns the file it was given
  // when nothing moved, and `stampAll` mints nothing for a line that has an
  // id - and the third, the archive append, was made so (`boardWrites.js`).
  const showingBoard = pluginOfView(view) !== null && tabs.some((one) => boardViewOf(one.plugin) === view)
  const kept = showingBoard ? boardsFor(store, now) : { boards: [], notices: [] }
  // Not awaited: a draw is what the window owes the person in front of it, and
  // a write is what it owes the vault afterwards.
  if (showingBoard) void keepBoards(store, now, kept.boards, now)

  // Nothing draws the day's margin while a board is up, so nothing asks for
  // one - the threshold rule again, applied to a hidden page rather than a
  // short one.
  const drawn = !showingBoard && dayPage.roomForABox(window)
    ? boxFor(store, page, glanceOf(store.page(page), now, store.config().horizonLeadDays), wearing(store))
    : { box: null, notices: [] }

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
    blocks: blocked.blocks,
    // Settled once, by the same store `sectionsFor` just asked: the view
    // matches a contributed row to its note through these rather than
    // through any prefix name of its own.
    prefixes: store.pluginPrefixes(),
    badges: marked.badges,
    box: drawn.box,
    view,
    tabs,
    boards: kept.boards,
    // The one thing a notice ever needs pressing for: the app will not put a
    // vault somewhere nobody asked for (spec §8).
    actions: store.vaultExists() ? [] : [{ label: 'Choose a folder…', run: () => { void pickVault(store, ipc) } }],
    // Worked out on the way to the page rather than kept, so redrawing the
    // same contributions does not say the same thing twice.
    notices: [...store.notices(), ...given.notices, ...marked.notices, ...blocked.notices, ...warmed, ...drawn.notices, ...kept.notices],
  })

  // Tried on every draw until it lands: a note just created is not in the
  // store until its day has been listed and the file read. Given up on
  // quietly rather than said out loud, because a ref may name a note whose
  // plugin has since been switched off.
  if (revealing !== null) {
    if (showNote(page, revealing)) revealing = null
  } else {
    // The note already up, offered the store's copy again. This is how an
    // edit made in a text editor reaches a note that is open; `open` holds it
    // until the caret leaves rather than taking the words out from under it.
    const shown = dayPage.noteView().showing()
    const named = shown === null ? null : readRef(shown)
    if (named !== null) showNote(named.date, named.suffix)
  }

  // The search holds its own query; this is what puts a late answer under it.
  dayPage.search().refresh()
}

/**
 * Puts a note over the day, if the app knows enough about it yet.
 *
 * False while the day's listing or the file's own text is still in flight -
 * both are draw-on-miss reads that redraw when they land, so the caller has
 * only to ask again on the next pass rather than wait on anything here.
 *
 * The title comes from the listing, which reads it off the file's own first
 * heading: the words at the top of a note are yours, never a plugin's answer
 * about it (spec §4.2).
 *
 * @param {string} date
 * @param {string} suffix
 * @returns {boolean}  whether the note is now on screen
 */
function showNote(date, suffix) {
  const named = store.sidecarsOn(date).find((one) => one.suffix === suffix)
  if (named === undefined) return false
  const text = store.sidecar(date, suffix)
  if (text === null) return false
  dayPage.noteView().open({
    id: sidecarRef(date, suffix),
    title: named.title,
    subtitle: `Note · ${STAMP.format(new Date(`${date}T00:00:00Z`))}`,
    path: sidecarPath(date, suffix) ?? '',
    text,
    back: 'Back to the day',
  })
  return true
}

/**
 * Puts the note away.
 *
 * `‹` and Escape say the note is finished with; they do not hide it
 * themselves, so that one place owns the question of what is on screen. Wire
 * this to anything that does not call `close`, and both of them become dead
 * keys. A note that has just been deleted has already hidden itself, and
 * `close` a second time is a no-op that keeps the two ways out one way out.
 *
 * @returns {void}
 */
function closeNote() {
  dayPage.noteView().close()
  // Nothing is waiting to be opened any more: a suffix parked before the note
  // landed would otherwise put it straight back up on the next draw.
  revealing = null
  draw()
}

/**
 * Moves a note into the vault's `.trash/` (spec §2.4).
 *
 * Straight to the shell rather than through the store: there is no cache to
 * keep in step by hand, because the move is announced like any other change
 * to that file and the store re-reads on it. False, with a line in the notice
 * band, when it will not go - the view keeps the note rather than pretending
 * it is gone.
 *
 * @param {string} date
 * @param {string} suffix
 * @returns {Promise<boolean>}
 */
async function remove(date, suffix) {
  try {
    await ipc.deleteSidecar(date, suffix)
    return true
  } catch (error) {
    store.notice(`Could not delete that note: ${message(error)}`)
    return false
  }
}

/**
 * Opens an address somebody typed into a note (spec §2.3).
 *
 * Not `ipc.openUrl`, which carries a plugin's name because it is a plugin's
 * address and is checked against the prefixes that plugin was approved for.
 * This one is yours: it takes the scheme check - in `core/markdown.js` before
 * the link is drawn at all, and again in Rust before it is handed to the
 * shell - and no allowlist, because that list exists to constrain plugins
 * rather than the person whose notes these are.
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
async function openLink(url) {
  try {
    await ipc.openLink(url)
  } catch (error) {
    store.notice(`Could not open ${url}: ${message(error)}`)
  }
}

/**
 * What `sidecarActions.js` is allowed to do to this window. Built once, not
 * per call: the getters read the state as it is when they are called, which
 * is the whole reason they are getters.
 *
 * @type {import('./sidecarActions.js').Surface}
 */
const surface = {
  store,
  page: () => showing.page(),
  go: (date) => { showing.go(date, today()) },
  reveal: (suffix) => { revealing = suffix },
  closeSearch: () => { dayPage.search().close() },
  draw: () => { draw() },
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
