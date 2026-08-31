// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { serialize } from '../src/core/serialize.js'
import { createItem, createDayDocument, createSomedayDocument } from '../src/core/model.js'

describe('headers', () => {
  test('writes a day header', () => {
    assert.equal(serialize(createDayDocument('2026-08-31')), '# 2026-08-31\n\n')
  })

  test('writes a someday header', () => {
    assert.equal(serialize(createSomedayDocument()), '# Someday\n\n')
  })
})

describe('items', () => {
  /** @param {import('../src/core/model.js').Item} item */
  const line = (item) => {
    const doc = createDayDocument('2026-08-31')
    doc.nodes = [item]
    return serialize(doc).split('\n')[1]
  }

  test('writes each state with its mark', () => {
    assert.equal(line(createItem('a', { state: 'open' })), '- [ ] a')
    assert.equal(line(createItem('a', { state: 'done' })), '- [x] a')
    assert.equal(line(createItem('a', { state: 'migrated' })), '- [>] a')
    assert.equal(line(createItem('a', { state: 'dropped' })), '- [-] a')
  })

  test('writes tokens in canonical order regardless of how they were set', () => {
    const item = createItem('Firmware sign-off', {
      movedTo: '2026-09-05', lead: 10, due: '2026-09-02', time: '09:00',
    })
    assert.equal(line(item),
      '- [ ] Firmware sign-off @09:00 !2026-09-02 ~10d >2026-09-05')
  })

  test('omits absent tokens', () => {
    assert.equal(line(createItem('Plain')), '- [ ] Plain')
  })

  test('an item with no text has no trailing space', () => {
    assert.equal(line(createItem('')), '- [ ]')
  })

  test('an empty item that has a token keeps the separator', () => {
    assert.equal(line(createItem('', { time: '08:00' })), '- [ ] @08:00')
  })
})

describe('notes', () => {
  test('writes a note two spaces in', () => {
    const doc = createDayDocument('2026-08-31')
    doc.nodes = [createItem('Review PR', { note: 'ask about the timeout' })]
    assert.equal(serialize(doc),
      '# 2026-08-31\n- [ ] Review PR\n  > ask about the timeout\n')
  })

  test('writes one line per note line', () => {
    const doc = createDayDocument('2026-08-31')
    doc.nodes = [createItem('Thing', { note: 'first\nsecond' })]
    assert.equal(serialize(doc),
      '# 2026-08-31\n- [ ] Thing\n  > first\n  > second\n')
  })

  test('an empty note line writes a bare marker with no trailing space', () => {
    const doc = createDayDocument('2026-08-31')
    doc.nodes = [createItem('Thing', { note: '' })]
    assert.equal(serialize(doc), '# 2026-08-31\n- [ ] Thing\n  >\n')
  })
})

describe('opaque nodes and the daily note', () => {
  test('opaque nodes are written verbatim', () => {
    const doc = createDayDocument('2026-08-31')
    doc.nodes = [{ kind: 'opaque', raw: '| a | b |' }, { kind: 'opaque', raw: '' }]
    assert.equal(serialize(doc), '# 2026-08-31\n| a | b |\n\n')
  })

  test('the daily note follows a rule and one blank line', () => {
    const doc = createDayDocument('2026-08-31')
    doc.dailyNote = 'Long day.'
    assert.equal(serialize(doc), '# 2026-08-31\n\n---\n\nLong day.\n')
  })

  test('a null daily note writes no rule', () => {
    const doc = createDayDocument('2026-08-31')
    doc.dailyNote = null
    assert.equal(serialize(doc), '# 2026-08-31\n\n')
  })

  test('an empty daily note still writes its rule', () => {
    const doc = createDayDocument('2026-08-31')
    doc.dailyNote = ''
    assert.equal(serialize(doc), '# 2026-08-31\n\n---\n')
  })

  test('output always ends with exactly one newline', () => {
    const doc = createDayDocument('2026-08-31')
    doc.dailyNote = 'note'
    const out = serialize(doc)
    assert.equal(out.endsWith('\n'), true)
    assert.equal(out.endsWith('\n\n'), false)
  })
})

describe('frontmatter', () => {
  test('is written above the header', () => {
    const doc = createDayDocument('2026-08-31')
    doc.frontmatter = ['tags: work']
    assert.equal(serialize(doc), '---\ntags: work\n---\n# 2026-08-31\n\n')
  })

  test('an empty block writes bare delimiters', () => {
    const doc = createDayDocument('2026-08-31')
    doc.frontmatter = []
    assert.equal(serialize(doc), '---\n---\n# 2026-08-31\n\n')
  })

  test('null writes nothing at all', () => {
    assert.equal(serialize(createDayDocument('2026-08-31')), '# 2026-08-31\n\n')
  })
})
