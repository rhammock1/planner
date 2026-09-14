// @ts-check

/**
 * The detached window (spec §5.6): a tab strip, and whichever view is behind
 * it.
 *
 * The popover only ever shows a day. This is where more than one day fits, so
 * it is a real window - moved, resized, and left open beside whatever else is
 * on screen. Same components and same theme tokens as the popover; only the
 * chrome differs.
 */

import { el, setText, setClass } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'
import { SOMEDAY } from '../core/vaultIndex.js'
import { VIEWS, viewLabel } from './spreadViews.js'
import { createBackPage } from './backPage.js'
import { createWeekView } from './weekView.js'
import { createMonthView } from './monthView.js'
import { createFileView } from './fileView.js'
import { createBoardView, boardViewOf, pluginOfView } from './boardView.js'
import { createSearchPanel } from './searchPanel.js'

/** @typedef {import('../core/vaultIndex.js').VaultIndex} VaultIndex */

/**
 * @typedef {object} SpreadState
 * @property {string} view  which of VIEWS is showing
 * @property {string} today `YYYY-MM-DD`
 * @property {string} anchor  a date in the week, or month, being looked at
 * @property {VaultIndex} vault
 * @property {Map<string, Map<number, import('../core/badges.js').Badge[]>>} [badges]  markers, by page
 * @property {import('./noteView.js').Note|null} file  the file the window has
 *   open, or null. Not a member of `VIEWS`: its tab exists only while it does
 * @property {import('../plugins/pageAsking.js').Board[]} [boards]  a tab each,
 *   for the plugins that keep one. Not in `VIEWS` either, and for a stronger
 *   reason than the file's: which boards exist is not known until a config has
 *   been read, and changes when one is
 * @property {string[]} notices
 */

/**
 * @typedef {object} SpreadHandlers
 * @property {(pageOf: () => string) => import('../pageEdits.js').PageEdits} editsFor
 * @property {(view: string) => void} onView
 * @property {(anchor: string) => void} onAnchor  '' means today
 * @property {(from: string, index: number, to: string) => void} onMove  a line
 *   dragged from one page onto another
 * @property {(plugin: string, id: string, column: string, before: string|null) => void} onCard
 *   a card dropped in another of a board's columns
 * @property {(id: string) => void} onFinish  a card dropped on the last
 *   column, which is not a drop target: a card gets there by its line being
 *   ticked (kanban design §6)
 * @property {(plugin: string, href: string) => void} onBadge
 * @property {(query: string) => {groups: import('../core/search.js').Group[], found: number}} onSearch
 * @property {(query: string) => {groups: {plugin: string, hits: import('../core/provided.js').Provided[]}[], notices: string[]}} onProviders
 * @property {(hit: import('../core/search.js').Hit) => void} onJump
 * @property {(hit: import('../core/provided.js').Provided) => void} onFollow
 * @property {import('./noteView.js').NoteHandlers} file  the editor a file
 *   opens in, grouped rather than spread across four more `on…` names - the
 *   way the day page's already are
 */

/** @typedef {{element: HTMLElement, render: (state: SpreadState) => void}} View */

/** @type {{tabs: Map<string, HTMLElement>, views: Map<string, View>, file: ReturnType<typeof createFileView>, boardTabs: HTMLElement, boardTabSpec: import('../ui/keyedList.js').ListSpec<import('../plugins/pageAsking.js').Board>, notices: HTMLElement, search: ReturnType<typeof createSearchPanel>}|null} */
let chrome = null

/** @type {SpreadState|null} */
let currentState = null

/**
 * Builds the window once. Everything after this is a patch.
 *
 * @param {HTMLElement} root
 * @param {SpreadHandlers} handlers
 * @returns {void}
 */
export function mount(root, handlers) {
  const file = createFileView(handlers.file)

  /** @type {Map<string, View>} */
  const views = new Map([
    ['week', createWeekView(handlers.editsFor, handlers.onAnchor, handlers.onMove, handlers.onBadge)],
    ['month', createMonthView(handlers.onAnchor, handlers.onView)],
    ['someday', createBackPage(handlers.editsFor(() => SOMEDAY), handlers.onBadge)],
    // Deliberately not in `VIEWS`. That list is read by the day page's footer
    // as well as by this strip, and a tab there that opened a window with no
    // file in it would be exactly the promise `VIEWS` exists to stop the app
    // making (spec §3.3).
    ['file', file],
    // One view for however many boards there are (spec §2.2). Which one it
    // draws is whichever the strip has picked, so it is here under one name
    // rather than being built and torn down as plugins come and go.
    ['board', createBoardView(() => boardShowing(), handlers.onCard, handlers.onFinish)],
  ])

  /** @type {Map<string, HTMLElement>} */
  const tabs = new Map()
  const strip = el('div', 'tabs')
  for (const name of VIEWS) {
    const tab = el('button', 'tab', viewLabel(name))
    tab.setAttribute('type', 'button')
    tab.addEventListener('click', () => handlers.onView(name))
    tabs.set(name, tab)
    strip.append(tab)
  }

  // The boards' tabs, between the three views and the file's: a board is a
  // fixture of the window the way Week and Month are, where the file's tab
  // comes and goes with the file. Patched rather than built, because which
  // boards exist is a thing the config decides and can change while the
  // window is open.
  const boardTabs = el('span', 'tabs-boards')
  /** @type {import('../ui/keyedList.js').ListSpec<import('../plugins/pageAsking.js').Board>} */
  const boardTabSpec = {
    keyOf: (board) => board.plugin,
    create: (board) => {
      const tab = el('button', 'tab')
      tab.setAttribute('type', 'button')
      tab.addEventListener('click', () => handlers.onView(boardViewOf(board.plugin)))
      return tab
    },
    update: (element, board) => {
      setText(element, board.tab)
      setClass(element, 'on', showing() === boardViewOf(board.plugin))
    },
  }
  strip.append(boardTabs)

  // The file's tab: built like the others, hidden until there is a file, and
  // labelled with the file's own name rather than the word "File" - one open
  // file at a time, so the tab may as well say which.
  const fileTab = el('button', 'tab', 'File')
  fileTab.setAttribute('type', 'button')
  fileTab.hidden = true
  fileTab.addEventListener('click', () => handlers.onView('file'))
  tabs.set('file', fileTab)
  strip.append(fileTab)

  const head = el('header', 'spread-head')
  head.append(strip)

  const notices = el('ul', 'notices')

  const body = el('div', 'spread-body')
  for (const view of views.values()) body.append(view.element)

  const search = createSearchPanel({
    onQuery: handlers.onSearch,
    onProviders: handlers.onProviders,
    onJump: handlers.onJump,
    onFollow: handlers.onFollow,
  })

  const surface = el('div', 'spread')
  surface.append(head, notices, body, search.element)
  root.replaceChildren(surface)

  chrome = { tabs, views, file, boardTabs, boardTabSpec, notices, search }
}

/**
 * The search that lies over the window (spec §5.7). The same panel the day
 * page uses; only what a result jumps to differs.
 *
 * @returns {ReturnType<typeof createSearchPanel>}
 */
export function search() {
  if (chrome === null) throw new Error('search before mount')
  return chrome.search
}

/**
 * The file view, for the two things only the window can decide: flushing what
 * is half-typed before the window is put away, and closing the file.
 *
 * @returns {ReturnType<typeof createFileView>}
 */
export function file() {
  if (chrome === null) throw new Error('file before mount')
  return chrome.file
}

/**
 * @param {SpreadState} state
 * @returns {void}
 */
export function render(state) {
  if (chrome === null) throw new Error('render before mount')
  currentState = state

  const on = showing()

  for (const [name, tab] of chrome.tabs) setClass(tab, 'on', name === on)

  const fileTab = chrome.tabs.get('file')
  if (fileTab !== undefined) {
    fileTab.hidden = state.file === null
    if (state.file !== null) setText(fileTab, state.file.title)
  }
  // Patched after `on` is settled, because each tab draws its own `on` class
  // and `showing()` reads the state this render was given.
  patchList(chrome.boardTabs, state.boards ?? [], chrome.boardTabSpec)

  for (const [name, view] of chrome.views) {
    // Every board shares one view, so the one named `board` is on screen
    // whenever any board is.
    const shown = name === 'board' ? pluginOfView(on) !== null : name === on
    view.element.hidden = !shown
    // Only what is on screen is drawn. A hidden view measures nothing
    // correctly anyway, and redrawing all of them on every keystroke is work
    // nobody can see.
    if (shown) view.render(state)
  }

  patchList(chrome.notices, state.notices, {
    keyOf: (notice) => notice,
    create: () => el('li'),
    update: (element, notice) => setText(element, notice),
  })
}

/**
 * The view on screen, which is the one asked for unless there is no such
 * view: an unknown name is a bug, and an empty window would hide it.
 *
 * @returns {string}
 */
export function showing() {
  const asked = currentState?.view ?? ''
  // A file view with no file behind it is the empty window `VIEWS` exists to
  // prevent - which is what the window looks like for the moment between
  // being asked for a file and that file arriving.
  if (asked === 'file' && (currentState?.file ?? null) === null) return VIEWS[0] ?? ''
  // The same rule for a board, which needs it more: a plugin can be switched
  // off while its board is the tab you are looking at, and a window left
  // showing a board that no longer exists is a window showing nothing.
  if (pluginOfView(asked) !== null) return boardShowing() === null ? VIEWS[0] ?? '' : asked
  return chrome?.views.has(asked) === true ? asked : VIEWS[0] ?? ''
}

/**
 * The board the strip has picked, or null when it has not picked one - which
 * is every view that is not a board's, and a board whose plugin has gone.
 *
 * @returns {import('../plugins/pageAsking.js').Board|null}
 */
function boardShowing() {
  const plugin = pluginOfView(currentState?.view ?? '')
  if (plugin === null) return null
  return (currentState?.boards ?? []).find((board) => board.plugin === plugin) ?? null
}
