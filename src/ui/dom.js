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
