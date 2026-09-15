// @ts-check

/**
 * The markers a plugin puts after a line (spec §2.1).
 *
 * Rebuilt whole rather than patched: there are at most a handful, none of
 * them holds a caret, and a keyed list for two anchors would be more
 * machinery than the thing it manages.
 */

import { el } from '../ui/dom.js'

/** @typedef {import('../core/badges.js').Badge} Badge */

/**
 * @param {HTMLElement} into
 * @param {Badge[]} badges
 * @returns {void}
 */
export function drawBadges(into, badges) {
  // A line with no marker has no gap: the container is not there at all,
  // rather than there and empty with its own margin.
  into.hidden = badges.length === 0
  if (badges.length === 0) {
    into.replaceChildren()
    return
  }

  into.replaceChildren(...badges.map((badge) => {
    // An anchor, not a styled span: it is a link, it should look like one to
    // a screen reader, and Tab should stop on it.
    const mark = el('a', 'item-badge', badge.label)
    mark.setAttribute('href', '#')
    mark.setAttribute('role', 'link')
    // An anchor with an href is a drag source by default, and on a board it
    // sits inside a card that is one too. Dragging a marker means nothing
    // anywhere in this app, so it is off everywhere rather than on the board
    // alone (spec §8).
    mark.draggable = false
    mark.title = `${badge.plugin}: ${badge.href}`
    mark.dataset['plugin'] = badge.plugin
    mark.dataset['href'] = badge.href
    return mark
  }))
}

/**
 * Whether a click landed on a marker, and the app's response if it did.
 *
 * The anchor never navigates - `preventDefault` sees to that - and the
 * plugin whose badge it was is not asked anything; the click is the app's
 * (spec §2.1).
 *
 * @param {MouseEvent} event
 * @param {(plugin: string, href: string) => void} onBadge
 * @returns {boolean} whether the click was a badge's, so the caller's own
 *   handling (the checkbox) knows to stop
 */
export function badgeClicked(event, onBadge) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const mark = target.closest('.item-badge')
  if (!(mark instanceof HTMLElement)) return false

  event.preventDefault()
  const plugin = mark.dataset['plugin'] ?? ''
  const href = mark.dataset['href'] ?? ''
  if (plugin !== '' && href !== '') onBadge(plugin, href)
  return true
}
