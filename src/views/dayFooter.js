// @ts-check
/**
 * The bottom of the day page: where to go, and how much is left (spec §5.1).
 *
 * The strip holds two kinds of destination now. `Day` and a board are views of
 * this window and switch what is drawn above; `Week`, `Month` and `Someday`
 * open the window that shows more than one day. Both kinds are buttons, for
 * the reason they always were: they do something, and the keyboard has to be
 * able to reach them.
 *
 * What is new is that the strip can be asked to hold more names than the
 * window is wide enough for - a board is a tab, and how many boards there are
 * is a thing the plugins folder decides. `tabFit` settles which ones fit; the
 * rest go behind the `...` (phase four §8.3). This module's own share of that
 * is the measuring, which is the part that needs a browser and so is the part
 * kept smallest.
 */
import { el, setText, setClass } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'
import { fitTabs } from '../core/tabFit.js'
import { VIEWS, viewLabel } from './spreadViews.js'
import { boardViewOf } from './boardView.js'
import { createMoreMenu } from './moreMenu.js'

/** The view the popover is on when it is showing the day itself. Not a member
 *  of `VIEWS`, which is the other window's list. */
export const DAY_VIEW = 'day'

/**
 * The most tabs to show before the rest go in the menu.
 *
 * Five, which is `Day Week Month Someday` and one board - the strip the
 * popover opens at its default width. Past that the footer stops reading as
 * the bottom of a page and starts reading as a tab bar, whatever the window
 * has been dragged out to.
 */
const CAP = 5

/** What the `...` is filed under while its width is being remembered. Not a
 *  view name, and cannot collide with one: no board's tab is empty. */
const MORE = ''

/** @typedef {{plugin: string, tab: string}} BoardTab */

/**
 * @typedef {object} FootState
 * @property {number} open  how many lines on the day are still open
 * @property {readonly BoardTab[]} boards  every plugin keeping a board, in the
 *   order `installed` lists them
 * @property {string} view  what this window is showing - `DAY_VIEW`, or a
 *   board's view name. Never one of `VIEWS`: those are the other window's
 */

/**
 * @param {(view: string) => void} onView
 * @returns {{element: HTMLElement, render: (state: FootState) => void}}
 */
export function createDayFooter(onView) {
  const count = el('span', 'count')
  const strip = el('div', 'tabs')

  /** Every tab that is not a board's, by view name. @type {Map<string, HTMLElement>} */
  const fixed = new Map()
  // `Day` first, and a button like the rest: it used to be a label, because
  // the day was the only thing this window could show and you were always on
  // it. A board is a view of this window too, so `Day` is now somewhere to go
  // back to.
  for (const view of [DAY_VIEW, ...VIEWS]) {
    const tab = el('button', 'tab', viewLabel(view))
    tab.setAttribute('type', 'button')
    tab.addEventListener('click', () => onView(view))
    fixed.set(view, tab)
    strip.append(tab)
  }

  // The boards' tabs, patched into a span of their own the way the spread
  // window's are, and for the same reason: which boards exist is a thing the
  // config decides and can change while the window is open. `display:
  // contents` keeps them in the strip's own flex flow.
  const boardTabs = el('span', 'tabs-boards')
  strip.append(boardTabs)

  const menu = createMoreMenu(onView)
  strip.append(menu.element)

  const element = el('div', 'page-foot')
  element.append(strip, count)

  /**
   * What each label measures, remembered across renders.
   *
   * By the words rather than by the view, because the words are what the
   * width is about: two boards called `Notes` are one measurement, and a board
   * renamed in its manifest is a new one. Cleared by nothing - a strip has a
   * handful of labels in it, and a theme change rebuilds the window.
   *
   * @type {Map<string, number>}
   */
  const widths = new Map()

  /** The last fit's inputs, so an unchanged strip is not measured again.
   *  `render` runs on every keystroke in the add row. */
  let fitted = ''

  /**
   * The strip's own gap, read from the stylesheet on the first fit rather
   * than written down twice.
   *
   * Not at mount: the footer is not in the document yet then, and a computed
   * style off an unattached element is empty. Not per fit either -
   * `getComputedStyle` forces layout, and this is a constant of the sheet.
   *
   * @type {number|null}
   */
  let gap = null

  /**
   * Which tabs are on screen, and which are in the menu.
   *
   * @param {{key: string, label: string}[]} entries  in display order
   * @param {string[]} demotion
   * @returns {void}
   */
  function fit(entries, demotion) {
    // Everything visible before anything is measured: a hidden element has no
    // width, and the fit is about how wide these would be if they were shown.
    for (const entry of entries) tabOf(entry.key).hidden = false
    menu.element.hidden = false

    for (const entry of entries) {
      if (!widths.has(entry.label)) widths.set(entry.label, tabOf(entry.key).offsetWidth)
    }
    if (!widths.has(MORE)) widths.set(MORE, menu.element.offsetWidth)
    if (gap === null) gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0

    // The room the strip actually has, after the open count has taken its
    // share. Zero when nothing has been laid out yet - a page built but not
    // shown - and then nothing is demoted: a strip that hid its tabs because
    // it had not been measured would be a footer that filled in late.
    const available = strip.clientWidth
    const settled = available <= 0
      ? { shown: entries.map((entry) => entry.key), hidden: [] }
      : fitTabs(
          entries.map((entry) => ({ key: entry.key, width: widths.get(entry.label) ?? 0 })),
          demotion,
          { available, gap, more: widths.get(MORE) ?? 0, cap: CAP },
        )

    const shown = new Set(settled.shown)
    for (const entry of entries) tabOf(entry.key).hidden = !shown.has(entry.key)
    menu.render(entries
      .filter((entry) => !shown.has(entry.key))
      .map((entry) => ({ key: entry.key, label: entry.label, on: false })))
  }

  /**
   * @param {string} view
   * @returns {HTMLElement}
   */
  function tabOf(view) {
    const found = fixed.get(view) ?? boardTabs.querySelector(`[data-key="${CSS.escape(view)}"]`)
    if (!(found instanceof HTMLElement)) throw new Error(`no tab for ${view}`)
    return found
  }

  /** @type {import('../ui/keyedList.js').ListSpec<BoardTab>} */
  const boardTabSpec = {
    // The view name rather than the plugin's, so `tabOf` can find a board's
    // tab under the same name the fit and the menu call it by.
    keyOf: (board) => boardViewOf(board.plugin),
    create: (board) => {
      const tab = el('button', 'tab')
      tab.setAttribute('type', 'button')
      tab.addEventListener('click', () => onView(boardViewOf(board.plugin)))
      return tab
    },
    update: (tab, board) => { setText(tab, board.tab) },
  }

  // A window dragged narrower has to be measured again, and a resize is not a
  // draw: nothing else on this page changes when the width does. Guarded
  // because the two oldest WebKits the app runs on do not have it, and a
  // footer that never re-fits is better than a page that will not start.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      fitted = ''
      if (currentState !== null) render(currentState)
    }).observe(element)
  }

  /** @type {FootState|null} */
  let currentState = null

  /**
   * @param {FootState} state
   * @returns {void}
   */
  function render(state) {
    currentState = state
    setText(count, state.open === 0 ? 'nothing left' : `${state.open} left`)

    patchList(boardTabs, [...state.boards], boardTabSpec)

    const entries = [
      { key: DAY_VIEW, label: viewLabel(DAY_VIEW) },
      ...VIEWS.map((view) => ({ key: view, label: viewLabel(view) })),
      ...state.boards.map((board) => ({ key: boardViewOf(board.plugin), label: board.tab })),
    ]

    // Someday first, then the boards from the last backwards: Someday is the
    // one fixed view that is not somewhere you go often, and a sixth board's
    // tab exists because a folder holds a plugin rather than because anybody
    // asked for it. Day, Week and Month are absent, which is what makes them
    // fixed.
    const demotion = [
      'someday',
      ...state.boards.map((board) => boardViewOf(board.plugin)).reverse(),
    ]

    // Stringified rather than joined on a separator: a board's tab is a
    // plugin's own words and may hold whatever a separator would have been.
    const signature = JSON.stringify([strip.clientWidth, entries])
    if (signature !== fitted) {
      fitted = signature
      fit(entries, demotion)
    }

    // Which one you are on, applied after the fit and on every render: it
    // changes without the strip changing width, and marking it costs no
    // layout. `Week`, `Month` and `Someday` are never marked - they are not
    // places this window goes, they are the other window's door.
    for (const entry of entries) setClass(tabOf(entry.key), 'on', entry.key === state.view)
  }

  return { element, render }
}
