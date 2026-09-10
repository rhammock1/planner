import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isSuffix, isPrefix, sidecarPath, trashPath, stemOf, suffixFor, owns,
  sidecarRef, readRef, settlePrefixes, LONGEST_SUFFIX, LONGEST_PREFIX,
} from '../src/core/sidecars.js'

test('a suffix is lowercase words joined by single hyphens', () => {
  assert.equal(isSuffix('meeting'), true)
  assert.equal(isSuffix('meeting-standup'), true)
  assert.equal(isSuffix('note-review-pr-4412'), true)
  assert.equal(isSuffix('meeting1'), true)
})

test('a suffix that could name something else is not a suffix', () => {
  assert.equal(isSuffix(''), false)
  assert.equal(isSuffix('Meeting'), false, 'uppercase')
  assert.equal(isSuffix('-meeting'), false, 'leading hyphen')
  assert.equal(isSuffix('meeting-'), false, 'trailing hyphen')
  assert.equal(isSuffix('meeting--standup'), false, 'a doubled hyphen')
  assert.equal(isSuffix('meeting.standup'), false, 'a second stem')
  assert.equal(isSuffix('meeting/standup'), false, 'a folder')
  assert.equal(isSuffix('..'), false, 'climbing out')
  assert.equal(isSuffix('meeting standup'), false, 'a space')
  assert.equal(isSuffix('a'.repeat(LONGEST_SUFFIX + 1)), false, 'too long')
  assert.equal(isSuffix('a'.repeat(LONGEST_SUFFIX)), true, 'exactly long enough')
  assert.equal(isSuffix(42), false)
  assert.equal(isSuffix(null), false)
})

test('a prefix is a suffix that leaves room for a title', () => {
  assert.equal(isPrefix('meeting'), true)
  assert.equal(isPrefix('a'.repeat(LONGEST_PREFIX)), true)
  // Longer than this and `prefix-` plus a 48-character stem will not fit in
  // 64, so the plugin could name a note it could never name again.
  assert.equal(isPrefix('a'.repeat(LONGEST_PREFIX + 1)), false)
})

test('a sidecar sits in the day folder under the day stem', () => {
  assert.equal(
    sidecarPath('2026-09-01', 'meeting-standup'),
    '2026/09/2026-09-01.meeting-standup.md',
  )
})

test('a path is refused rather than guessed at', () => {
  assert.equal(sidecarPath('someday', 'meeting'), null, 'the back page has no date')
  assert.equal(sidecarPath('2026-9-1', 'meeting'), null, 'not a date')
  assert.equal(sidecarPath('2026-09-01', '../../etc/passwd'), null)
  assert.equal(sidecarPath('2026-09-01', ''), null)
})

test('a deleted note goes to the trash under a stamped name', () => {
  assert.equal(
    trashPath('2026-09-10', 'note-gift-card-promotions', 1757520000),
    '.trash/2026-09-10.note-gift-card-promotions.1757520000.md',
  )
})

test('deleting the same suffix twice does not collide', () => {
  const first = trashPath('2026-09-10', 'meeting-standup', 1757520000)
  const second = trashPath('2026-09-10', 'meeting-standup', 1757520061)
  assert.notEqual(first, second)
})

test('the trash is refused the names a sidecar is refused', () => {
  assert.equal(trashPath('2026-09-10', '../escape', 1757520000), null)
  assert.equal(trashPath('not-a-date', 'note-x', 1757520000), null)
  assert.equal(trashPath('2026-09-10', 'Note-X', 1757520000), null)
  assert.equal(trashPath('2026-09-10', 'note-x', -1), null, 'a time before the epoch')
  assert.equal(trashPath('2026-09-10', 'note-x', 1.5), null, 'seconds, whole ones')
})

test('a title becomes a stem a filesystem can hold', () => {
  assert.equal(stemOf('1:1 with Priya'), '1-1-with-priya')
  assert.equal(stemOf('  Standup  '), 'standup')
  assert.equal(stemOf('Retro // Q3'), 'retro-q3')
  assert.equal(stemOf('＋＋＋'), '', 'nothing survives, so there is no name')
})

test('a stem is cut at 48 and only then trimmed', () => {
  // Cut first, trim second: cutting inside a hyphen run must not leave the
  // stem ending in one, which would not be a legal suffix.
  const stem = stemOf(`${'a'.repeat(47)} b`)
  assert.equal(stem, 'a'.repeat(47), 'the cut landed on the hyphen, which went')
  assert.ok(stem.length <= 48)
})

test('a suffix is the prefix and the stem, and never more than 64', () => {
  assert.equal(suffixFor('meeting', '1:1 with Priya'), 'meeting-1-1-with-priya')
  assert.ok(suffixFor('a'.repeat(LONGEST_PREFIX), 'b'.repeat(80)).length <= LONGEST_SUFFIX)
  assert.equal(isSuffix(suffixFor('meeting', 'Retro // Q3')), true)
})

test('a title with no letters in it names nothing', () => {
  assert.equal(suffixFor('meeting', '＋＋＋'), '')
  assert.equal(suffixFor('Meeting', 'Standup'), '', 'and neither does a bad prefix')
})

test('a suffix belongs to a prefix, or to the prefix and a hyphen', () => {
  assert.equal(owns(['meeting'], 'meeting'), true)
  assert.equal(owns(['meeting'], 'meeting-standup'), true)
  assert.equal(owns(['meeting'], 'meetings'), false, 'a longer word is a different word')
  assert.equal(owns(['meeting'], 'note-standup'), false)
  assert.equal(owns([], 'meeting'), false, 'no table means no prefixes')
})

test('an href names a day and a suffix, and nothing else', () => {
  assert.equal(sidecarRef('2026-09-01', 'meeting-standup'), 'sidecar:2026-09-01/meeting-standup')
  assert.deepEqual(
    readRef('sidecar:2026-09-01/meeting-standup'),
    { date: '2026-09-01', suffix: 'meeting-standup' },
  )
  assert.equal(readRef('sidecar:2026-09-01/../../etc/passwd'), null)
  assert.equal(readRef('sidecar:someday/meeting'), null)
  assert.equal(readRef('https://example.com'), null)
  assert.equal(readRef('sidecar:2026-09-01'), null, 'no suffix')
  assert.equal(readRef(null), null)
})

test('the first plugin in name order keeps a contested prefix', () => {
  const settled = settlePrefixes([
    { name: 'meeting-notes', prefixes: ['meeting'] },
    { name: 'zebra-notes', prefixes: ['meeting-extra', 'zebra'] },
  ])
  assert.deepEqual(settled.owned.get('meeting-notes'), ['meeting'])
  assert.deepEqual(settled.owned.get('zebra-notes'), ['zebra'], 'it keeps what nobody wanted')
  assert.equal(settled.notices.length, 1)
  assert.match(settled.notices[0] ?? '', /zebra-notes/)
  assert.match(settled.notices[0] ?? '', /meeting-notes/)
})

test('name order decides, not the order the folders arrived in', () => {
  const settled = settlePrefixes([
    { name: 'zebra-notes', prefixes: ['meeting'] },
    { name: 'meeting-notes', prefixes: ['meeting'] },
  ])
  assert.deepEqual(settled.owned.get('meeting-notes'), ['meeting'])
  assert.deepEqual(settled.owned.get('zebra-notes'), [])
})

test('one plugin naming a prefix twice has named it once', () => {
  const settled = settlePrefixes([{ name: 'a-plugin', prefixes: ['note', 'note'] }])
  assert.deepEqual(settled.owned.get('a-plugin'), ['note'])
  assert.deepEqual(settled.notices, [])
})
