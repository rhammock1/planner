// @ts-check

/**
 * The one place in this app that needs a framework, and the whole of it
 * (spec §4.4).
 *
 * The item list is inline-editable. Rebuilding it on every change would be
 * three lines and would destroy the caret every time the file is re-read -
 * which, given that every edit round-trips through the filesystem, is on
 * every keystroke that commits. So the list is patched instead: children are
 * matched by key, only what changed is touched, and an element holding the
 * caret is left entirely alone.
 *
 * If this file passes ~150 lines, or two views need shared derived state, the
 * no-framework decision was wrong and a real one should replace it.
 */

/**
 * @template T
 * @typedef {object} ListSpec
 * @property {(item: T) => string} keyOf  stable within one render pass
 * @property {(item: T) => HTMLElement} create
 * @property {(element: HTMLElement, item: T, caret: HTMLElement|null) => void} update
 *   `caret` is the element inside this row that is being typed into, if any.
 *   An update must not overwrite that one element's text; everything else
 *   about the row is its to bring up to date.
 */

/**
 * Brings `container`'s children into line with `items`.
 *
 * @template T
 * @param {HTMLElement} container
 * @param {readonly T[]} items
 * @param {ListSpec<T>} spec
 * @returns {void}
 */
export function patchList(container, items, spec) {
  /** @type {Map<string, HTMLElement>} */
  const existing = new Map()
  for (const child of container.children) {
    if (!(child instanceof HTMLElement)) continue
    const key = child.dataset['key']
    if (key !== undefined) existing.set(key, child)
  }

  const focused = container.ownerDocument.activeElement
  /** @type {Element|null} */
  let cursor = container.firstElementChild

  for (const item of items) {
    const key = spec.keyOf(item)
    const found = existing.get(key)

    if (found === undefined) {
      // create builds the shell, update fills it. Doing both here means a row
      // has exactly one code path for its contents, whether it was just made
      // or has been on the page all along.
      const created = spec.create(item)
      created.dataset['key'] = key
      spec.update(created, item, null)
      container.insertBefore(created, cursor)
      continue
    }

    existing.delete(key)

    // A row is never moved while it holds focus, because moving it blurs
    // whatever was focused.
    //
    // The caret is narrower than that. It protects the one element being
    // typed into - overwriting that would take the words out from under the
    // user - and nothing else. Not the row: a line crossed out while its text
    // is focused has to show the cross-out, or the next keystroke deletes
    // something the page never admitted it had struck. Not a focused button
    // either: that is how a ticked checkbox came to show as unticked.
    if (found === cursor) cursor = cursor.nextElementSibling
    else if (!holdsFocus(found, focused)) container.insertBefore(found, cursor)

    spec.update(found, item, caretIn(found, focused))
  }

  for (const orphan of existing.values()) orphan.remove()
}

/**
 * @param {HTMLElement} element
 * @param {Element|null} focused
 * @returns {boolean}
 */
function holdsFocus(element, focused) {
  return focused !== null && element.contains(focused)
}

/**
 * The element inside `row` that is being typed into, or null.
 *
 * @param {HTMLElement} row
 * @param {Element|null} focused
 * @returns {HTMLElement|null}
 */
function caretIn(row, focused) {
  return holdsCaret(row, focused) && focused instanceof HTMLElement ? focused : null
}

/**
 * Whether the focus inside this element is somewhere text is being entered -
 * a field, or anything made editable.
 *
 * @param {HTMLElement} element
 * @param {Element|null} focused
 * @returns {boolean}
 */
function holdsCaret(element, focused) {
  if (!holdsFocus(element, focused) || !(focused instanceof HTMLElement)) return false
  return focused.isContentEditable
    || focused instanceof HTMLInputElement
    || focused instanceof HTMLTextAreaElement
}
