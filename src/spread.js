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
import { readRef, owns } from './core/sidecars.js'
import { badgesFor, cardBadgesFor, boardsFor, providedFor, openBadge } from './plugins/pageAsking.js'
import { boardViewOf } from './views/boardView.js'
import { keepBoards, dropCard } from './plugins/boardWrites.js'
import { lineWithId } from './core/ids.js'
import { weekOf } from './core/calendar.js'
import { SOMEDAY } from './core/vaultIndex.js'
import { createFiles } from './fileStore.js'
import { titleOf, folderOf, insideVault } from './core/files.js'
import { expandHome, shortenHome } from './core/config.js'
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

// The one file this window has open, if it has been handed one (spec §3.3).
const files = createFiles({
  onChanged: () => { draw() },
  notice: (line) => { store.notice(line) },
})

/** The home directory, for showing a path the way a person writes it. */
let home = ''

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
    onCard: (plugin, id, column, before) => { void dropCard(store, plugin, id, column, before) },

    /**
     * A card dropped on the last column, which is not a drop target: a card
     * gets there by its line being ticked, and ticking a line is a write into
     * your day file that a board does not make (kanban design §6).
     *
     * The refusal does the useful half. In the popover that is the day page
     * with the caret on the line; this window has no day page and no caret,
     * so it does what a search hit and a provider's hit both already do here
     * and moves to the week that day sits in - where the line is on screen
     * with its checkbox, one click from the tick (spec §5.7).
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
      view = found.page === SOMEDAY ? 'someday' : 'week'
      if (found.page !== SOMEDAY) anchor = found.page
      draw()
    },
    onBadge: (plugin, href) => {
      const ref = readRef(href)
      // A note of somebody's, and this window cannot show one: it draws weeks
      // and months, and a block lives on a day page. So it does what a
      // provider's hit does here - moves to the week that day sits in, and
      // leaves opening it to the popover (spec §4.3).
      if (ref !== null) {
        // Spec §4.1: every `sidecar:` href, from any slot, is checked against
        // the answering plugin's prefixes - the same check `openMarker` in
        // `sidecarActions.js` makes for the popover's own badge.
        const prefixes = store.pluginPrefixes().get(plugin) ?? []
        if (!owns(prefixes, ref.suffix)) {
          store.notice(`${plugin} pointed at a note that is not one of its own.`)
          return
        }
        // Badges are drawn on the week view and the back page alike; without
        // this a `✎` clicked from the someday view would move `anchor` under
        // a view that never shows it - a dead click with no notice.
        view = 'week'
        anchor = ref.date
        draw()
        return
      }
      void openBadge(store, plugin, href)
    },
    onAnchor: (next) => {
      // '' is how a view says "back to now" without holding a clock itself.
      anchor = next === '' ? today() : next
      draw()
    },
    onSearch: (query) => search(store.vault(), query),
    onProviders: (query) => providedFor(store, query),
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
    onFollow: (hit) => {
      // This window shows weeks and months, so a hit lands on the week its day
      // sits in. There is no block to put a caret in here - the spread has no
      // sections - so the href only says which day (spec §2.3).
      const named = hit.href === null ? null : readRef(hit.href)
      const page = named?.date ?? hit.date
      if (page === null) return
      view = 'week'
      anchor = page
      spreadPage.search().close()
      draw()
    },
    file: {
      onWrite: (path, text) => files.change(path, text),
      // No `onDelete`: you named this file and put it where it is (spec §3.2).
      onFollow: (href) => {
        const ref = readRef(href)
        if (ref === null) return
        // This window draws weeks and months, not a day's notes, so a
        // `sidecar:` link inside a file lands on the week that day sits in -
        // which is what a provider's hit already does here (spec §4.3).
        view = 'week'
        anchor = ref.date
        draw()
      },
      onOpenLink: (url) => { void openLink(url) },
      onClose: () => { closeFile() },
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

  const started = await store.start(draw)
  home = started.home

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

  // A file open here follows an edit made in nvim the same way a day does -
  // but only inside the vault, which is the only folder being watched. Not
  // fatal: the file still opens and still saves.
  try {
    await files.start()
  } catch (error) {
    store.notice(`A file open here will save but not follow edits made elsewhere: ${message(error)}`)
  }

  // What this window was handed, and everything handed to it later. Asked for
  // rather than passed in the URL, because a second `planner <path>` can
  // arrive before this webview has finished loading (see spread.rs).
  try {
    const asked = await ipc.spreadFile()
    if (asked !== null && asked !== '') await files.open(asked)
    await ipc.onSpreadFile((path) => { void files.open(path) })
  } catch (error) {
    store.notice(`This window will not be handed a file: ${message(error)}`)
  }

  // A window that is put away keeps its timers but stops being looked at.
  // ⌘W a keystroke after typing would otherwise sit on the settle window with
  // nothing to end it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void spreadPage.file().flush()
  })

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

/**
 * Opens an address somebody typed into a file (spec §2.3).
 *
 * The same one the day page has, for the same reason: you typed the link, so
 * there is no plugin to name and no approved list to check it against - only
 * the scheme check, made in `core/markdown.js` before the link is drawn and
 * again in Rust before it is handed to the shell.
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
 * Puts the file away.
 *
 * Flushed first, then let go of: `‹` is a way out, not a way to lose the last
 * thing typed. The shell is told too, so it stops reading that path when the
 * watcher fires (spec §2.5).
 *
 * @returns {void}
 */
function closeFile() {
  void spreadPage.file().flush().finally(() => ipc.closeFile().catch(() => {}))
  files.close()
  // The tab is about to go, so the window cannot stay on it.
  if (view === 'file') view = VIEWS[0] ?? ''
  draw()
}

function draw() {
  // The day this draw is about, settled once. `today()` read twice in one draw
  // can straddle midnight and give two answers, and the board's writes are
  // decided against one of them and written into the page named by the other -
  // an id stamped on the wrong day. One value cannot disagree with itself.
  const day = today()

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
  // talk to each other, and each keeps its own minute clock.
  const warmed = applyPluginTokens(store, draw)

  // The boards, which are tabs of their own (spec §2.2). Asked about today,
  // whatever week the window happens to be showing: a board is an arrangement
  // of the day you are on, and asking about the anchored day would make
  // walking back through the weeks stamp ids into those old pages - browsing
  // that writes to files.
  //
  // A task on an older day reaches the board by being carried forward, which
  // leaves the old line `migrated` and the carried copy live. Seeding the old
  // line instead would mint a second name for a task that already has one,
  // which is the case `migrated` exists to refuse.
  const kept = boardsFor(store, day)
  // What the answer means for the three files it may change (kanban design
  // §6). Not awaited: a draw is what the window owes the person in front of
  // it, and a write is what it owes the vault afterwards. A no-op on almost
  // every draw, and it tells the window when it is not.
  void keepBoards(store, day, kept.boards, day)

  // What the plugins say about the cards of the board on screen, and only
  // that one: a question about cards nobody is looking at is a plugin woken
  // for nothing. A card's note is found by the card's words, so a card whose
  // line is on no page in view still finds one (spec §8).
  const marks = cardBadgesFor(store, day, kept.boards.filter((one) => boardViewOf(one.plugin) === view))

  // The file this window is holding, as the view wants it: a title, a
  // subtitle, a path and an id it never looks inside (spec §3.1).
  const open = files.showing()
  /** @type {import('./views/noteView.js').Note|null} */
  const file = open === null ? null : {
    id: open.path,
    title: titleOf(open.text, open.path),
    subtitle: shortenHome(folderOf(open.path), home),
    path: shortenHome(open.path, home),
    text: open.text,
    back: 'Close the file',
    state: open.exists ? 'Saved' : 'New file',
  }

  // Said out loud rather than looking like it is keeping up: the watcher runs
  // on the vault, so a file kept anywhere else will be written over by this
  // window's autosave if it is edited elsewhere at the same time (spec §2.5).
  const root = expandHome(store.config().vault, home)
  const unwatched = open === null || insideVault(open.path, root)
    ? []
    : [`${shortenHome(open.path, home)} is outside the vault, so edits made to it elsewhere will not show here.`]

  spreadPage.render({
    view,
    today: day,
    anchor,
    vault: store.vault(),
    badges,
    cardBadges: marks.badges,
    file,
    boards: kept.boards,
    notices: [
      ...store.notices(),
      ...badgeNotices,
      ...kept.notices,
      ...marks.notices,
      ...warmed,
      ...unwatched,
    ],
  })

  // The search holds its own query; this is what puts a late answer under it.
  spreadPage.search().refresh()
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
