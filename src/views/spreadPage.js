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
import { createSearchPanel } from './searchPanel.js'

/** @typedef {import('../core/vaultIndex.js').VaultIndex} VaultIndex */

/**
 * @typedef {object} SpreadState
 * @property {string} view  which of VIEWS is showing
 * @property {string} today `YYYY-MM-DD`
 * @property {string} anchor  a date in the week, or month, being looked at
 * @property {VaultIndex} vault
 * @property {Map<string, Map<number, import('../core/badges.js').Badge[]>>} [badges]  markers, by page
 * @property {string[]} notices
 */

/**
 * @typedef {object} SpreadHandlers
 * @property {(pageOf: () => string) => import('../pageEdits.js').PageEdits} editsFor
 * @property {(view: string) => void} onView
 * @property {(anchor: string) => void} onAnchor  '' means today
 * @property {(from: string, index: number, to: string) => void} onMove  a line
 *   dragged from one page onto another
 * @property {(plugin: string, href: string) => void} onBadge
 * @property {(query: string) => {groups: import('../core/search.js').Group[], found: number}} onSearch
 * @property {(query: string) => {groups: {plugin: string, hits: import('../core/provided.js').Provided[]}[], notices: string[]}} onProviders
 * @property {(hit: import('../core/search.js').Hit) => void} onJump
 * @property {(hit: import('../core/provided.js').Provided) => void} onFollow
 */

/** @typedef {{element: HTMLElement, render: (state: SpreadState) => void}} View */

/** @type {{tabs: Map<string, HTMLElement>, views: Map<string, View>, notices: HTMLElement, search: ReturnType<typeof createSearchPanel>}|null} */
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
  /** @type {Map<string, View>} */
  const views = new Map([
    ['week', createWeekView(handlers.editsFor, handlers.onAnchor, handlers.onMove, handlers.onBadge)],
    ['month', createMonthView(handlers.onAnchor, handlers.onView)],
    ['someday', createBackPage(handlers.editsFor(() => SOMEDAY), handlers.onBadge)],
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

  chrome = { tabs, views, notices, search }
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
 * @param {SpreadState} state
 * @returns {void}
 */
export function render(state) {
  if (chrome === null) throw new Error('render before mount')
  currentState = state

  const on = showing()

  for (const [name, tab] of chrome.tabs) setClass(tab, 'on', name === on)
  for (const [name, view] of chrome.views) {
    view.element.hidden = name !== on
    // Only what is on screen is drawn. A hidden view measures nothing
    // correctly anyway, and redrawing all of them on every keystroke is work
    // nobody can see.
    if (name === on) view.render(state)
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
  return chrome?.views.has(asked) === true ? asked : VIEWS[0] ?? ''
}
