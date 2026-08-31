// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'

describe('files written by other tools', () => {
  test('CRLF line endings still parse items and notes', () => {
    const doc = parse('# 2026-08-31\r\n\r\n- [ ] hello @10:30\r\n  > note\r\n')
    assert.equal(doc.kind, 'day')
    const items = doc.nodes.filter((n) => n.kind === 'item')
    assert.equal(items.length, 1)
    assert.equal(items[0]?.text, 'hello')
    assert.equal(items[0]?.time, '10:30')
    assert.equal(items[0]?.note, 'note')
  })

  test('a leading blank line does not demote a day file', () => {
    const doc = parse('\n# 2026-08-31\n- [ ] x\n')
    assert.equal(doc.kind, 'day')
    assert.equal(doc.date, '2026-08-31')
  })

  test('a UTF-8 BOM does not demote a day file', () => {
    const doc = parse('\uFEFF# 2026-08-31\n- [ ] x\n')
    assert.equal(doc.kind, 'day')
    assert.equal(doc.date, '2026-08-31')
  })

  test('a headerless file is still a someday file', () => {
    // The Task 7 ruling stands: only a file whose first non-blank line is a
    // header is promoted. This one has none.
    const doc = parse('\n\n- [ ] loose item\n')
    assert.equal(doc.kind, 'someday')
  })

  test('a file of nothing but blank lines is an empty someday file', () => {
    const doc = parse('\n\n\n')
    assert.equal(doc.kind, 'someday')
    assert.equal(doc.date, null)
    assert.equal(doc.dailyNote, null)
  })

  test('blank lines between frontmatter and the header still find the header', () => {
    const doc = parse('---\ntags: work\n---\n\n# 2026-08-31\n- [ ] x\n')
    assert.deepEqual(doc.frontmatter, ['tags: work'])
    assert.equal(doc.kind, 'day')
    assert.equal(doc.date, '2026-08-31')
  })
})

describe('item text is preserved, not reflowed', () => {
  /** @param {string} text */
  const roundTripText = (text) => {
    const node = parse(`# 2026-08-31\n- [ ] ${text}\n`).nodes[0]
    return node?.kind === 'item' ? node.text : null
  }

  test('non-ASCII whitespace is left alone', () => {
    assert.equal(roundTripText('今日\u3000の予定'), '今日\u3000の予定')
    assert.equal(roundTripText('caf\u00e9\u00a0latte'), 'caf\u00e9\u00a0latte')
  })

  test('tabs and double spaces are left alone', () => {
    assert.equal(roundTripText('col1\tcol2'), 'col1\tcol2')
    assert.equal(roundTripText('a  b'), 'a  b')
  })

  test('removing a token still closes its gap cleanly', () => {
    assert.equal(roundTripText('Review PR @14:00 before standup'), 'Review PR before standup')
    assert.equal(roundTripText('@09:00 Standup !2026-09-04'), 'Standup')
  })
})
