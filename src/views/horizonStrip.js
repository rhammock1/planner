// @ts-check

/**
 * The horizon strip: a thin band of what is coming (spec §5.3).
 *
 * Which deadlines belong here, and in what order, was decided by
 * `core/horizon.js`. This module only draws them - and decides whether the
 * band has to move to show them all.
 */

import { el, setClass } from '../ui/dom.js'

/** @typedef {import('../core/horizon.js').HorizonEntry} HorizonEntry */

/**
 * @returns {{element: HTMLElement, render: (entries: HorizonEntry[]) => void}}
 */
export function createHorizonStrip() {
  const track = el('div', 'horizon-track')
  const mask = el('div', 'horizon-mask')
  mask.append(track)

  const element = el('div', 'horizon')
  element.append(el('span', 'horizon-label', 'Ahead'), mask)

  return {
    element,
    render: (entries) => {
      element.hidden = entries.length === 0
      if (entries.length === 0) return

      const run = buildRun(entries, false)
      track.replaceChildren(run)

      // Measured only once the run is in the document: the width of text is
      // not knowable any other way. A strip that fits sits still, because a
      // band scrolling with nothing to scroll to is movement for its own sake.
      const overflows = run.scrollWidth > mask.clientWidth
      setClass(track, 'marquee', overflows)
      if (overflows) track.append(buildRun(entries, true))
      else run.style.paddingRight = '0'
    },
  }
}

/**
 * The second run is what the loop translates onto: half the track's width,
 * exactly. It is hidden from assistive technology, and from a reduced-motion
 * reader who scrolls the first one instead.
 *
 * @param {HorizonEntry[]} entries
 * @param {boolean} repeat
 * @returns {HTMLElement}
 */
function buildRun(entries, repeat) {
  const run = el('div', repeat ? 'horizon-run repeat' : 'horizon-run')
  if (repeat) run.setAttribute('aria-hidden', 'true')

  for (const entry of entries) {
    const item = el('span', entry.overdue ? 'hz due' : 'hz')
    item.append(
      el('b', undefined, daysLabel(entry.daysRemaining)),
      document.createTextNode(entry.item.text),
    )
    run.append(item)
  }
  return run
}

/**
 * @param {number} days
 * @returns {string}
 */
function daysLabel(days) {
  if (days < 0) return `${Math.abs(days)}d late`
  if (days === 0) return 'today'
  return `${days}d`
}
