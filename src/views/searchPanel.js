// @ts-check

/**
 * `⌘F`: a field over the page, and every line in the vault that matches it
 * (spec §5.7).
 *
 * An overlay rather than a view of its own, because searching is something
 * you do to the page you are on and then stop doing. Escape puts it away and
 * leaves the day exactly where it was.
 *
 * The vault's own results are drawn at once, on every keystroke - they are in
 * memory and never wait for anybody. A plugin holding `search.provide` is
 * asked 150 ms after the last keystroke, and its hits grow groups after the
 * vault's, headed by its name (spec §2.3).
 */

import { el, setText } from '../ui/dom.js'
import { SOMEDAY } from '../core/vaultIndex.js'
import { MOST } from '../core/search.js'

/** @typedef {import('../core/search.js').Group} Group */
/** @typedef {import('../core/search.js').Hit} Hit */
/** @typedef {import('../core/provided.js').Provided} Provided */

/** How long after the last keystroke the providers are asked (spec §2.3). */
const ASKED_AFTER = 150

const HEADING = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})

/**
 * @param {object} handlers
 * @param {(query: string) => {groups: Group[], found: number}} handlers.onQuery
 *   the vault's own results, now, synchronously
 * @param {(query: string) => {groups: {plugin: string, hits: Provided[]}[], notices: string[]}} handlers.onProviders
 *   what the plugins have said about this query, asking if nobody has
 * @param {(hit: Hit) => void} handlers.onJump
 * @param {(hit: Provided) => void} handlers.onFollow  a provider's hit
 * @returns {{element: HTMLElement, open: () => void, close: () => void, isOpen: () => boolean, refresh: () => void}}
 */
export function createSearchPanel(handlers) {
  const field = el('input', 'search-field')
  field.setAttribute('type', 'search')
  field.setAttribute('placeholder', 'Find a line')
  field.setAttribute('aria-label', 'Find a line anywhere in the vault')

  const results = el('div', 'search-results')
  const provided = el('div', 'search-provided')
  const summary = el('div', 'search-summary')

  /** What the field held when the providers were last asked. The panel holds
   *  it so an answer that lands after the keystroke that caused it still has
   *  a query to be an answer to (spec §2.3). */
  let asked = ''
  /** @type {ReturnType<typeof setTimeout>|null} */
  let waiting = null

  const element = el('div', 'search')
  element.hidden = true
  element.append(field, results, provided, summary)

  field.addEventListener('input', () => {
    const query = field instanceof HTMLInputElement ? field.value : ''
    // The vault, at once. It is in memory and it never waits for anybody.
    render(results, summary, handlers.onJump, query, handlers.onQuery(query))

    // The providers, once the typing stops. A plugin gets one question per
    // pause rather than one per keystroke.
    if (waiting !== null) clearTimeout(waiting)
    if (query.trim() === '') {
      asked = ''
      provided.replaceChildren()
      return
    }
    waiting = setTimeout(() => {
      asked = query
      renderProvided()
    }, ASKED_AFTER)
  })

  // Escape belongs to the search while the search is up: the day underneath
  // would otherwise close the whole popover on the first press.
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  })

  function renderProvided() {
    if (asked === '') {
      provided.replaceChildren()
      return
    }
    const given = handlers.onProviders(asked)
    provided.replaceChildren(...given.groups.map((group) => providerSection(group, handlers.onFollow)))
  }

  function close() {
    element.hidden = true
    if (field instanceof HTMLInputElement) field.value = ''
    results.replaceChildren()
    provided.replaceChildren()
    asked = ''
    if (waiting !== null) clearTimeout(waiting)
    setText(summary, '')
  }

  return {
    element,
    isOpen: () => !element.hidden,
    open: () => {
      element.hidden = false
      field.focus()
    },
    close,
    /**
     * Draws the providers' answers again against the query the panel still
     * holds. Called on every draw, because a plugin answers when it answers
     * and the keystroke that asked is long over (spec §1.4).
     */
    refresh: () => { if (!element.hidden) renderProvided() },
  }
}

/**
 * @param {HTMLElement} results
 * @param {HTMLElement} summary
 * @param {(hit: Hit) => void} onJump
 * @param {string} query
 * @param {{groups: Group[], found: number}} found
 * @returns {void}
 */
function render(results, summary, onJump, query, found) {
  // Rebuilt whole. The list changes completely on almost every keystroke, so
  // there is nothing for a patcher to keep.
  results.replaceChildren(...found.groups.map((group) => section(group, onJump)))

  if (query.trim() === '') {
    setText(summary, '')
    return
  }
  if (found.found === 0) {
    setText(summary, 'nothing')
    return
  }
  // Said only when it is true, so the number is a fact about the query rather
  // than a permanent piece of furniture. Counts vault hits only - what the
  // vault holds is a fact about your files, and a provider answers late.
  setText(summary, found.found > MOST ? `first ${MOST} of ${found.found}` : `${found.found}`)
}

/**
 * @param {Group} group
 * @param {(hit: Hit) => void} onJump
 * @returns {HTMLElement}
 */
function section(group, onJump) {
  const block = el('div', 'search-group')
  block.append(el('div', 'search-day', dayName(group.page)))

  for (const hit of group.hits) {
    const line = el('button', `search-hit ${hit.kind}`, hit.text)
    line.setAttribute('type', 'button')
    line.addEventListener('click', () => onJump(hit))
    block.append(line)
  }
  return block
}

/**
 * One provider's hits, under its name.
 *
 * Headed by the plugin rather than by a day, because that is what these have
 * in common: they came from somewhere that is not your files.
 *
 * @param {{plugin: string, hits: Provided[]}} group
 * @param {(hit: Provided) => void} onFollow
 * @returns {HTMLElement}
 */
function providerSection(group, onFollow) {
  const block = el('div', 'search-group')
  block.append(el('div', 'search-day provider', group.plugin))

  for (const hit of group.hits) {
    const line = el('button', 'search-hit provided', hit.text)
    line.setAttribute('type', 'button')
    line.addEventListener('click', () => onFollow(hit))
    block.append(line)
  }
  return block
}

/**
 * @param {string} page
 * @returns {string}
 */
function dayName(page) {
  if (page === SOMEDAY) return 'Someday'
  // Parsed as UTC and formatted as UTC, so the name of the day never shifts
  // by a timezone - the page key is a calendar date, not an instant.
  return HEADING.format(new Date(`${page}T00:00:00Z`))
}
