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

describe('inline tokens', () => {
  /** @param {string} line */
  const item = (line) => {
    const node = parse(`# 2026-08-31\n${line}\n`).nodes[0]
    assert.equal(node?.kind, 'item')
    return /** @type {import('../src/core/model.js').Item} */ (node)
  }

  test('extracts a time and strips it from the text', () => {
    const it = item('- [ ] Pair with Dana on the offline queue @10:30')
    assert.equal(it.text, 'Pair with Dana on the offline queue')
    assert.equal(it.time, '10:30')
  })

  test('zero-pads a single-digit hour', () => {
    assert.equal(item('- [ ] Dentist @8:40').time, '08:40')
  })

  test('extracts a due date and a lead time', () => {
    const it = item('- [ ] Firmware sign-off !2026-09-02 ~10d')
    assert.equal(it.text, 'Firmware sign-off')
    assert.equal(it.due, '2026-09-02')
    assert.equal(it.lead, 10)
  })

  test('extracts a migration target', () => {
    const it = item('- [>] Order the Pi Zero >2026-09-01')
    assert.equal(it.text, 'Order the Pi Zero')
    assert.equal(it.movedTo, '2026-09-01')
  })

  test('extracts tokens from anywhere in the line', () => {
    const it = item('- [ ] @09:00 Standup !2026-09-04')
    assert.equal(it.text, 'Standup')
    assert.equal(it.time, '09:00')
    assert.equal(it.due, '2026-09-04')
  })

  test('leaves an impossible time in the text', () => {
    const it = item('- [ ] Ping the API @25:99')
    assert.equal(it.text, 'Ping the API @25:99')
    assert.equal(it.time, null)
  })

  test('leaves an impossible date in the text', () => {
    const it = item('- [ ] Taxes !2026-02-30')
    assert.equal(it.text, 'Taxes !2026-02-30')
    assert.equal(it.due, null)
  })

  test('does not treat prose punctuation as tokens', () => {
    const it = item('- [ ] Email dana@gotab.io about the 5~10 range -> soon!')
    assert.equal(it.text, 'Email dana@gotab.io about the 5~10 range -> soon!')
    assert.equal(it.time, null)
    assert.equal(it.due, null)
    assert.equal(it.lead, null)
    assert.equal(it.movedTo, null)
  })

  test('collapses the whitespace left behind by a removed token', () => {
    const it = item('- [ ] Review PR @14:00 before standup')
    assert.equal(it.text, 'Review PR before standup')
  })

  test('the last occurrence wins, which is what keeps repeats stable', () => {
    // serialize writes the token at the end of the line, so reading the last
    // one means a file with two times settles instead of oscillating.
    const it = item('- [ ] Twice @09:00 @10:00')
    assert.equal(it.time, '10:00')
    assert.equal(it.text, 'Twice @09:00')
  })

  test('an invalid later token does not beat a valid earlier one', () => {
    const it = item('- [ ] Both @09:00 @25:99')
    assert.equal(it.time, '09:00')
    assert.equal(it.text, 'Both @25:99')
  })
})

describe('notes', () => {
  test('attaches a note to the item above it', () => {
    const doc = parse([
      '# 2026-08-31',
      '- [ ] Review PR #4412 — printer retry',
      '  > ask about the 30s timeout',
    ].join('\n'))

    assert.equal(doc.nodes.length, 1)
    const node = doc.nodes[0]
    assert.equal(node?.kind === 'item' && node.note, 'ask about the 30s timeout')
  })

  test('joins consecutive note lines with a newline', () => {
    const doc = parse([
      '# 2026-08-31',
      '- [ ] Firmware sign-off',
      '  > checklist is in the wiki',
      '  > ping Marcus for the serials',
    ].join('\n'))

    const node = doc.nodes[0]
    assert.equal(node?.kind === 'item' && node.note,
      'checklist is in the wiki\nping Marcus for the serials')
  })

  test('an empty note line contributes an empty line', () => {
    const doc = parse('# 2026-08-31\n- [ ] Thing\n  >\n')
    const node = doc.nodes[0]
    assert.equal(node?.kind === 'item' && node.note, '')
  })

  test('a note line with no item above it is opaque', () => {
    const doc = parse('# 2026-08-31\n  > orphaned\n')
    assert.deepEqual(doc.nodes, [{ kind: 'opaque', raw: '  > orphaned' }])
  })

  test('a note line after an opaque line is opaque', () => {
    const doc = parse('# 2026-08-31\n| table |\n  > not a note\n')
    assert.deepEqual(doc.nodes, [
      { kind: 'opaque', raw: '| table |' },
      { kind: 'opaque', raw: '  > not a note' },
    ])
  })

  test('a blank line ends the note', () => {
    const doc = parse([
      '# 2026-08-31',
      '- [ ] Thing',
      '  > first',
      '',
      '  > second',
    ].join('\n'))

    const first = doc.nodes[0]
    assert.equal(first?.kind === 'item' && first.note, 'first')
    assert.deepEqual(doc.nodes[1], { kind: 'opaque', raw: '' })
    assert.deepEqual(doc.nodes[2], { kind: 'opaque', raw: '  > second' })
  })

  test('tokens inside a note are not parsed', () => {
    const doc = parse('# 2026-08-31\n- [ ] Thing\n  > due !2026-09-02 maybe\n')
    const node = doc.nodes[0]
    assert.equal(node?.kind === 'item' && node.note, 'due !2026-09-02 maybe')
    assert.equal(node?.kind === 'item' && node.due, null)
  })
})

describe('daily note', () => {
  test('reads the text after the rule', () => {
    const doc = parse([
      '# 2026-08-31',
      '- [ ] Thing',
      '',
      '---',
      '',
      'Shipped the retry fix.',
    ].join('\n'))

    assert.equal(doc.dailyNote, 'Shipped the retry fix.')
    assert.equal(doc.nodes.length, 2)
    assert.equal(doc.nodes[0]?.kind, 'item')
    assert.deepEqual(doc.nodes[1], { kind: 'opaque', raw: '' })
  })

  test('keeps a multi-line note intact', () => {
    const doc = parse('# 2026-08-31\n---\n\nLine one.\n\nLine two.\n')
    assert.equal(doc.dailyNote, 'Line one.\n\nLine two.')
  })

  test('only the last rule starts the note', () => {
    const doc = parse('# 2026-08-31\n---\nmiddle\n---\nthe note\n')
    assert.equal(doc.dailyNote, 'the note')
    assert.deepEqual(doc.nodes, [
      { kind: 'opaque', raw: '---' },
      { kind: 'opaque', raw: 'middle' },
    ])
  })

  test('a rule with nothing after it leaves an empty note', () => {
    const doc = parse('# 2026-08-31\n- [ ] Thing\n---\n')
    assert.equal(doc.dailyNote, '')
  })

  test('no rule means no note', () => {
    const doc = parse('# 2026-08-31\n- [ ] Thing\n')
    assert.equal(doc.dailyNote, '')
  })

  test('an indented rule is not a rule', () => {
    const doc = parse('# 2026-08-31\n  ---\nstill body\n')
    assert.equal(doc.dailyNote, '')
    assert.equal(doc.nodes.length, 2)
  })
})
