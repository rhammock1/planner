// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'

describe('header', () => {
  test('reads a day header', () => {
    const doc = parse('# 2026-08-31\n')
    assert.equal(doc.kind, 'day')
    assert.equal(doc.date, '2026-08-31')
    assert.deepEqual(doc.nodes, [])
  })

  test('reads a someday header', () => {
    const doc = parse('# Someday\n')
    assert.equal(doc.kind, 'someday')
    assert.equal(doc.date, null)
  })

  test('a file with no header is a someday document and keeps its content', () => {
    const doc = parse('- [ ] loose item\n')
    assert.equal(doc.kind, 'someday')
    assert.equal(doc.nodes.length, 1)
  })

  test('an invalid date in the header is not a header', () => {
    const doc = parse('# 2026-13-45\n')
    assert.equal(doc.kind, 'someday')
    assert.deepEqual(doc.nodes, [{ kind: 'opaque', raw: '# 2026-13-45' }])
  })
})

describe('item lines', () => {
  test('parses all four states', () => {
    const doc = parse([
      '# 2026-08-31',
      '- [ ] open one',
      '- [x] done one',
      '- [>] migrated one',
      '- [-] dropped one',
    ].join('\n'))

    assert.deepEqual(doc.nodes.map((n) => n.kind === 'item' ? n.state : null),
      ['open', 'done', 'migrated', 'dropped'])
    assert.deepEqual(doc.nodes.map((n) => n.kind === 'item' ? n.text : null),
      ['open one', 'done one', 'migrated one', 'dropped one'])
  })

  test('accepts an uppercase X', () => {
    const doc = parse('# 2026-08-31\n- [X] shouting\n')
    const node = doc.nodes[0]
    assert.equal(node?.kind === 'item' && node.state, 'done')
  })

  test('an item with no text is still an item', () => {
    const doc = parse('# 2026-08-31\n- [ ] \n')
    const node = doc.nodes[0]
    assert.equal(node?.kind, 'item')
    assert.equal(node?.kind === 'item' && node.text, '')
  })
})

describe('opaque lines', () => {
  test('blank lines are preserved as opaque nodes', () => {
    const doc = parse('# 2026-08-31\n\n- [ ] thing\n')
    assert.deepEqual(doc.nodes[0], { kind: 'opaque', raw: '' })
    assert.equal(doc.nodes[1]?.kind, 'item')
  })

  test('unrecognised prose is preserved verbatim', () => {
    const doc = parse('# 2026-08-31\n| a | b |\n  indented thing\n')
    assert.deepEqual(doc.nodes, [
      { kind: 'opaque', raw: '| a | b |' },
      { kind: 'opaque', raw: '  indented thing' },
    ])
  })

  test('a bullet that is not a task is opaque', () => {
    const doc = parse('# 2026-08-31\n- just a bullet\n')
    assert.deepEqual(doc.nodes, [{ kind: 'opaque', raw: '- just a bullet' }])
  })

  test('a trailing newline does not produce a trailing blank node', () => {
    const doc = parse('# 2026-08-31\n- [ ] thing\n')
    assert.equal(doc.nodes.length, 1)
  })
})
