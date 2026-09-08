// @ts-check

/**
 * The four DOM conveniences the views actually use. Anything more belongs in
 * a view, or is the framework this app decided not to have.
 */

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [textContent]
 * @returns {HTMLElement}
 */
export function el(tag, className, textContent) {
  const element = document.createElement(tag)
  if (className !== undefined) element.className = className
  if (textContent !== undefined) element.textContent = textContent
  return element
}

/**
 * Writes text only when it differs. Assigning textContent replaces the node's
 * children, which drops a selection inside it even when the text is the same.
 *
 * @param {HTMLElement} element
 * @param {string} value
 * @returns {void}
 */
export function setText(element, value) {
  if (element.textContent !== value) element.textContent = value
}

/**
 * Adds or removes a class from its presence in one call, so a view can say
 * what is true rather than branch on it.
 *
 * @param {HTMLElement} element
 * @param {string} className
 * @param {boolean} present
 * @returns {void}
 */
export function setClass(element, className, present) {
  element.classList.toggle(className, present)
}

/**
 * @param {HTMLElement} parent
 * @returns {void}
 */
export function clear(parent) {
  parent.replaceChildren()
}

/**
 * The order these sheets sit in, last one winning (spec §3.3).
 *
 * Written down rather than left to whoever asks first. The three used to be
 * appended in creation order, which made the cascade a fact about the order
 * four files happen to run in - and a plugin that could not move a colour
 * because a sheet was created a moment early would look like a plugin that
 * had simply answered nothing.
 *
 * Not `@layer`, which would say the same thing in one line: the app's floor is
 * macOS 11, whose WebKit does not know the rule, and a browser that skips a
 * `@layer` block skips the theme with it. A silent loss of every colour is a
 * worse trade than a list.
 */
const SHEETS = ['theme-tokens', 'theme-css', 'theme-plugin']

/**
 * The one style element with a given id, made if it is not there yet.
 *
 * A new one is put in its place in `SHEETS` rather than at the end, so asking
 * for them out of order still cascades in order.
 *
 * @param {string} id
 * @returns {HTMLStyleElement}
 */
export function styleElement(id) {
  const existing = document.querySelector(`#${id}`)
  if (existing instanceof HTMLStyleElement) return existing
  const created = document.createElement('style')
  created.id = id

  // The first sheet that belongs after this one, if it is already there.
  const after = SHEETS.slice(SHEETS.indexOf(id) + 1)
  const next = SHEETS.indexOf(id) === -1
    ? null
    : after.map((one) => document.querySelector(`#${one}`)).find((one) => one !== null) ?? null

  if (next === null) document.head.append(created)
  else next.before(created)
  return created
}
