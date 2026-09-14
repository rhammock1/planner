// @ts-check

/**
 * Which tabs fit in a strip, and which go behind the `...` (phase four §8.3).
 *
 * The day page's footer used to hold four tabs and never had to think about
 * it. A board is a tab too, and how many boards there are is a thing the
 * plugins folder decides - so the strip can be asked to hold six names in a
 * window that has been dragged down to 300 points, and something has to give.
 *
 * One rule, from the three cases it was asked for:
 *
 *   - Day, Week and Month are fixed. They are how you get anywhere, and a
 *     strip that hid them would hide the way out of wherever you are.
 *   - Someday and the boards are demotable, Someday first and then the boards
 *     from the last backwards. Someday is the one fixed view that is not a
 *     place you go often, and the boards past the first are the ones whose
 *     tabs exist because a folder happens to hold a plugin.
 *   - At most `cap` tabs, and no more than fit.
 *
 * Widths are measured by the caller and passed in. Nothing here knows what a
 * tab looks like, which is what makes the rule testable without a browser and
 * keeps it honest when a theme changes the footer's type.
 */

/**
 * @typedef {object} Tab
 * @property {string} key
 * @property {number} width  as measured, in px
 */

/**
 * @typedef {object} Room
 * @property {number} available  px the strip has to lay tabs in
 * @property {number} gap  px between two tabs
 * @property {number} more  px the `...` button takes, when there is one
 * @property {number} cap  the most tabs to show before the rest are demoted
 */

/**
 * The tabs that fit, and the ones that do not.
 *
 * Both lists come back in display order rather than in demotion order, so the
 * menu reads down the strip the tabs came out of.
 *
 * @param {readonly Tab[]} tabs  in display order
 * @param {readonly string[]} demotion  keys, the first to go first
 * @param {Room} room
 * @returns {{shown: string[], hidden: string[]}}
 */
export function fitTabs(tabs, demotion, room) {
  /** @type {Set<string>} */
  const hidden = new Set()

  // Demoted one at a time and measured again, rather than worked out from a
  // total: each tab is a different width, and dropping the widest is not what
  // was asked for - the order is the rule.
  for (;;) {
    const shown = tabs.filter((tab) => !hidden.has(tab.key))
    if (shown.length <= room.cap && spanOf(shown, hidden.size > 0, room) <= room.available) break

    // Nothing left that may be demoted. The fixed tabs are wider than the
    // window, which is a floor rather than a case to handle: a strip with no
    // Day on it is worse than a strip that clips.
    const next = demotion.find((key) => !hidden.has(key))
    if (next === undefined) break
    hidden.add(next)
  }

  return {
    shown: tabs.filter((tab) => !hidden.has(tab.key)).map((tab) => tab.key),
    hidden: tabs.filter((tab) => hidden.has(tab.key)).map((tab) => tab.key),
  }
}

/**
 * What a set of tabs takes, counting the `...` as one more tab whenever there
 * is anything behind it.
 *
 * @param {readonly Tab[]} shown
 * @param {boolean} overflowing
 * @param {Room} room
 * @returns {number}
 */
function spanOf(shown, overflowing, room) {
  const count = shown.length + (overflowing ? 1 : 0)
  if (count === 0) return 0
  const tabs = shown.reduce((total, tab) => total + tab.width, 0)
  return tabs + (overflowing ? room.more : 0) + room.gap * (count - 1)
}
