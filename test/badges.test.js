// @ts-check

/**
 * What a plugin is shown of a page, and what it may put back.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parse } from '../src/core/parse.js'
import { linesOf, badgeKey, readBadges } from '../src/core/badges.js'

const PAGE = parse(`- [ ] Review PR #4412 @14:00
  the one about retries
- [x] Water the plants

Some prose the parser did not understand.
`)

test('a plugin is shown every line the parser understood, and its index', () => {
  const lines = linesOf(PAGE)
  assert.deepEqual(lines.map((line) => line.text), ['Review PR #4412', 'Water the plants'])
  // The index addresses `doc.nodes`, which is what a badge comes back with.
  for (const line of lines) assert.equal(typeof line.index, 'number')
})

test('a plugin is not shown the note under a line', () => {
  for (const line of linesOf(PAGE)) {
    assert.doesNotMatch(line.text, /retries/)
  }
})

test('a plugin is not shown a line the parser did not understand', () => {
  for (const line of linesOf(PAGE)) {
    assert.doesNotMatch(line.text, /prose/)
  }
})

test('a plugin is shown a line\'s name when it has one, and null when it has not', () => {
  const page = parse('- [ ] Named ^k4m2qa\n- [ ] Anonymous\n')
  assert.deepEqual(linesOf(page).map((line) => line.id), ['k4m2qa', null])
})

test('asking about a page mints nothing and changes nothing', () => {
  // The lazy rule, at the one place that would break it: `item.badge` is asked
  // on every draw of every page, so if drawing could stamp, browsing a vault
  // would fill it with names nobody asked for (spec §2.3). Nothing here
  // writes, and the page it was handed comes back the same object.
  const page = parse('- [ ] Anonymous\n- [ ] Also anonymous\n')
  const before = JSON.stringify(page)
  const lines = linesOf(page)
  badgeKey('2026-09-02', lines)
  readBadges([], lines)
  assert.deepEqual(lines.map((line) => line.id), [null, null])
  assert.equal(JSON.stringify(page), before)
})

test('a name changes the key, so an answer keyed on it is asked again', () => {
  // The other half: a line that gains a name has changed for a plugin that
  // reads one, and a cached answer from before the stamp would be stale.
  const anonymous = linesOf(parse('- [ ] Firmware sign-off\n'))
  const named = linesOf(parse('- [ ] Firmware sign-off ^k4m2qa\n'))
  assert.notEqual(badgeKey('2026-09-02', anonymous), badgeKey('2026-09-02', named))
})

test('a page with nothing on it shows nothing', () => {
  assert.deepEqual(linesOf(null), [])
})

test('the key changes when the lines do, and not when they do not', () => {
  const lines = linesOf(PAGE)
  assert.equal(badgeKey('2026-09-02', lines), badgeKey('2026-09-02', linesOf(PAGE)))
  assert.notEqual(badgeKey('2026-09-02', lines), badgeKey('2026-09-03', lines))
  assert.notEqual(
    badgeKey('2026-09-02', lines),
    badgeKey('2026-09-02', [{ index: 0, text: 'Review PR #4413', id: null }]),
  )
  // Not the page text: a keystroke in the daily note must not re-ask
  // (spec §1.4).
  assert.equal(badgeKey('2026-09-02', lines), badgeKey('2026-09-02', [...lines]))
})

const LINES = [
  { index: 0, text: 'Review PR #4412', id: null },
  { index: 2, text: 'Water the plants', id: null },
]

/** @param {unknown[]} value */
function said(value) {
  return [{ plugin: 'ticket-links', value }]
}

test('a badge in the right shape lands on the line it names', () => {
  const { badges, notices } = readBadges(
    said([{ index: 0, label: '#4412', href: 'https://github.com/o/r/pull/4412' }]),
    LINES,
  )
  assert.deepEqual(notices, [])
  assert.deepEqual(badges.get(0), [
    { plugin: 'ticket-links', label: '#4412', href: 'https://github.com/o/r/pull/4412' },
  ])
  assert.equal(badges.get(2), undefined)
})

test('a badge for a line that was never sent is dropped', () => {
  // The lines moved while the plugin was thinking, or it made the index up.
  const { badges, notices } = readBadges(said([{ index: 9, label: 'x', href: 'https://x/' }]), LINES)
  assert.equal(badges.size, 0)
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /ticket-links/)
})

test('a label is one line, cut at sixteen', () => {
  const { badges } = readBadges(
    said([{ index: 0, label: 'a very long label\nwith a second line', href: 'https://x/' }]),
    LINES,
  )
  const label = badges.get(0)?.[0]?.label ?? ''
  assert.equal(label.length, 16)
  assert.doesNotMatch(label, /\n/)
})

test('a badge with nothing to show is not a badge', () => {
  const { badges, notices } = readBadges(
    said([{ index: 0, label: '   ', href: 'https://x/' }, { index: 0, href: 'https://x/' }]),
    LINES,
  )
  assert.equal(badges.size, 0)
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /2/)
})

test('a badge with no href is not a badge', () => {
  const { badges } = readBadges(said([{ index: 0, label: '#1' }]), LINES)
  assert.equal(badges.size, 0)
})

test('one marker per line per plugin', () => {
  // "can put a marker after one" - not a row of them.
  const { badges, notices } = readBadges(
    said([
      { index: 0, label: '#1', href: 'https://x/1' },
      { index: 0, label: '#2', href: 'https://x/2' },
    ]),
    LINES,
  )
  assert.deepEqual(badges.get(0)?.map((one) => one.label), ['#1'])
  assert.equal(notices.length, 1)
})

test('two plugins may both mark a line, in the order they answered', () => {
  const { badges } = readBadges(
    [
      { plugin: 'alpha', value: [{ index: 0, label: 'a', href: 'https://x/a' }] },
      { plugin: 'zulu', value: [{ index: 0, label: 'z', href: 'https://x/z' }] },
    ],
    LINES,
  )
  assert.deepEqual(badges.get(0)?.map((one) => one.plugin), ['alpha', 'zulu'])
})

test('a plugin that answers with something other than a list is named', () => {
  const { badges, notices } = readBadges([{ plugin: 'ticket-links', value: 'no' }], LINES)
  assert.equal(badges.size, 0)
  assert.match(notices[0] ?? '', /ticket-links/)
})

test('nothing asked, nothing said', () => {
  const { badges, notices } = readBadges([], LINES)
  assert.equal(badges.size, 0)
  assert.deepEqual(notices, [])
})
