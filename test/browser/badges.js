// @ts-check

/**
 * The marker a plugin puts after a line - the one thing about it only a
 * browser can answer for: where it sits among the row's other elements, that
 * it survives a patch without disturbing the caret, and that clicking it
 * never lets the anchor navigate.
 */

import { check, ok, equal, report } from './harness.js'
import { parse } from '../../src/core/parse.js'
import { createItemList } from '../../src/views/itemList.js'

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

const PAGE = '# 2026-09-01\n\n- [ ] Review PR #4412\n- [ ] Nothing to say about this one\n'

/**
 * @param {string[]} clicked  filled with `${plugin} ${href}` on every onBadge call
 */
function mount(clicked = []) {
  stage.replaceChildren()
  const doc = parse(PAGE)
  const list = createItemList({
    onToggle: () => {},
    onEdit: async () => true,
    onNote: async () => true,
    onStrike: () => {},
    onRemove: async () => true,
    onBadge: (plugin, href) => { clicked.push(`${plugin} ${href}`) },
  })
  stage.append(list.element)
  return { list, doc }
}

/** @returns {HTMLElement[]} */
const rows = () => [...stage.querySelectorAll('.item')].map((row) => /** @type {HTMLElement} */ (row))

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
function lineSaying(text) {
  const row = rows().find((r) => r.querySelector('.item-text')?.textContent === text)
  if (row === undefined) throw new Error(`no line saying ${text}`)
  return row
}

/**
 * @param {HTMLElement} element
 * @param {number} offset
 * @returns {void}
 */
function caretInto(element, offset) {
  element.focus()
  const range = element.ownerDocument.createRange()
  const node = element.firstChild ?? element
  range.setStart(node, offset)
  range.collapse(true)
  const selection = element.ownerDocument.defaultView?.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

check('a badge is an anchor, after the time and before the note', () => {
  const { list, doc } = mount()
  list.render(doc, new Map([[1, [{ plugin: 'ticket-links', label: '#4412', href: 'https://x/pull/4412' }]]]))

  const row = lineSaying('Review PR #4412')
  const children = [...row.children]
  const marks = row.querySelector('.item-badges')
  ok(marks !== null, 'no badge container')
  const badge = marks?.querySelector('.item-badge')
  ok(badge instanceof HTMLAnchorElement, 'the marker is not an anchor')
  equal(badge?.textContent, '#4412', 'the wrong marker')

  const time = row.querySelector('.item-time')
  const note = row.querySelector('.item-note')
  if (time === null || note === null) throw new Error('no time or note')
  const timeAt = children.indexOf(time)
  const marksAt = children.indexOf(marks)
  const noteAt = children.indexOf(note)
  ok(timeAt < marksAt && marksAt < noteAt, `order is ${children.map((c) => c.className).join(', ')}`)
})

check('a row with no badge has an empty, hidden container', () => {
  const { list, doc } = mount()
  list.render(doc)

  const row = lineSaying('Nothing to say about this one')
  const marks = row.querySelector('.item-badges')
  ok(marks instanceof HTMLElement, 'no badge container')
  ok(marks.hidden, 'the container is not hidden')
  equal(marks.childElementCount, 0, 'the empty container still has children')
  equal(marks.getBoundingClientRect().width, 0, 'a hidden container took up width')
})

check('a badge survives a patch while the text holds the caret', () => {
  const { list, doc } = mount()
  list.render(doc, new Map([[1, [{ plugin: 'ticket-links', label: '#4412', href: 'https://x/pull/4412' }]]]))

  const text = lineSaying('Review PR #4412').querySelector('.item-text')
  if (!(text instanceof HTMLElement)) throw new Error('no text')
  caretInto(text, 3)
  const before = text.ownerDocument.getSelection()?.getRangeAt(0).startOffset

  // Same doc, a different badge - the text must not move under the caret,
  // and the marker must still update.
  list.render(doc, new Map([[1, [{ plugin: 'ticket-links', label: '#9999', href: 'https://x/pull/9999' }]]]))

  const row = lineSaying('Review PR #4412')
  equal(document.activeElement, text, 'the caret left the line')
  equal(text.ownerDocument.getSelection()?.getRangeAt(0).startOffset, before, 'the caret moved within the line')
  equal(row.querySelector('.item-badge')?.textContent, '#9999', 'the badge did not update')
})

check('clicking a badge calls onBadge and does not navigate', () => {
  /** @type {string[]} */
  const clicked = []
  const { list, doc } = mount(clicked)
  list.render(doc, new Map([[1, [{ plugin: 'ticket-links', label: '#4412', href: 'https://x/pull/4412' }]]]))

  const badge = lineSaying('Review PR #4412').querySelector('.item-badge')
  if (!(badge instanceof HTMLElement)) throw new Error('no badge')
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  badge.dispatchEvent(event)

  equal(clicked[0], 'ticket-links https://x/pull/4412', 'onBadge was not called with the plugin and href')
  ok(event.defaultPrevented, 'the click was not prevented, so the anchor would navigate')
})

check('Tab reaches the badge', () => {
  const { list, doc } = mount()
  list.render(doc, new Map([[1, [{ plugin: 'ticket-links', label: '#4412', href: 'https://x/pull/4412' }]]]))

  const badge = lineSaying('Review PR #4412').querySelector('.item-badge')
  ok(badge instanceof HTMLElement, 'no badge')
  // A plain anchor with an href is in the tab order without a tabindex of
  // its own - which is the point of drawing a link rather than a span.
  ok(badge.tabIndex >= 0, 'the badge is not reachable by Tab')
})

report()
