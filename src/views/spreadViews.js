// @ts-check

/**
 * The views the detached window has, in tab order.
 *
 * One list, read by both windows: the popover's footer offers exactly the
 * views that window can show, and the window falls back to the first when it
 * is asked for one it does not have. A tab that opens an empty window is a
 * promise the app does not keep, and this is what stops it happening.
 */

/** @type {readonly string[]} */
export const VIEWS = ['week', 'month', 'someday']

/**
 * @param {string} view
 * @returns {string} the name as a tab spells it
 */
export function viewLabel(view) {
  return view.slice(0, 1).toUpperCase() + view.slice(1)
}
