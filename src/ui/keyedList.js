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
 * @property {(element: HTMLElement, item: T) => void} update
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
      const created = spec.create(item)
      created.dataset['key'] = key
      container.insertBefore(created, cursor)
      continue
    }

    existing.delete(key)

    // An element holding the caret is neither moved nor updated. Moving it
    // would blur it, and updating it would overwrite what is being typed;
    // both are worse than a row briefly sitting in the wrong place, which
    // corrects itself on the next render after the field is left.
    if (holdsFocus(found, focused)) {
      if (found === cursor) cursor = cursor.nextElementSibling
      continue
    }

    if (found === cursor) cursor = cursor.nextElementSibling
    else container.insertBefore(found, cursor)

    spec.update(found, item)
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
