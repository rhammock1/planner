// @ts-check

/**
 * `⌘F`: a field over the page, and every line in the vault that matches it
 * (spec §5.7).
 *
 * An overlay rather than a view of its own, because searching is something
 * you do to the page you are on and then stop doing. Escape puts it away and
 * leaves the day exactly where it was.
 */

import { el, setText } from '../ui/dom.js'
import { SOMEDAY } from '../core/vaultIndex.js'
import { MOST } from '../core/search.js'

/** @typedef {import('../core/search.js').Group} Group */
/** @typedef {import('../core/search.js').Hit} Hit */

const HEADING = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})

/**
 * @param {{onQuery: (query: string) => {groups: Group[], found: number}, onJump: (hit: Hit) => void}} handlers
 * @returns {{element: HTMLElement, open: () => void, close: () => void, isOpen: () => boolean}}
 */
export function createSearchPanel(handlers) {
  const field = el('input', 'search-field')
  field.setAttribute('type', 'search')
  field.setAttribute('placeholder', 'Find a line')
  field.setAttribute('aria-label', 'Find a line anywhere in the vault')

  const results = el('div', 'search-results')
  const summary = el('div', 'search-summary')

  const element = el('div', 'search')
  element.hidden = true
  element.append(field, results, summary)

  field.addEventListener('input', () => {
    const query = field instanceof HTMLInputElement ? field.value : ''
    render(results, summary, handlers.onJump, query, handlers.onQuery(query))
  })

  // Escape belongs to the search while the search is up: the day underneath
  // would otherwise close the whole popover on the first press.
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  })

  function close() {
    element.hidden = true
    if (field instanceof HTMLInputElement) field.value = ''
    results.replaceChildren()
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
  // than a permanent piece of furniture.
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
 * @param {string} page
 * @returns {string}
 */
function dayName(page) {
  if (page === SOMEDAY) return 'Someday'
  // Parsed as UTC and formatted as UTC, so the name of the day never shifts
  // by a timezone - the page key is a calendar date, not an instant.
  return HEADING.format(new Date(`${page}T00:00:00Z`))
}
