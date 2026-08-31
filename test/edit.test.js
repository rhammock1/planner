// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { serialize } from '../src/core/serialize.js'
import { createItem, createDayDocument } from '../src/core/model.js'
import { setItemState, appendItem, setDailyNote } from '../src/core/edit.js'

const day = '# 2026-08-31\n\n- [ ] Pair with Dana @10:30\n  > about the queue\n- [x] Standup\n'

describe('setItemState', () => {
  test('marks an open item done', () => {
    const next = setItemState(parse(day), 1, 'done')
    assert.equal(serialize(next), '# 2026-08-31\n\n- [x] Pair with Dana @10:30\n  > about the queue\n- [x] Standup\n')
  })

  test('marks a done item open again', () => {
    // A note is folded into the item above it, so Standup is node 2, not 3.
    const next = setItemState(parse(day), 2, 'open')
    assert.match(serialize(next), /- \[ \] Standup/)
  })

  test('everything else on the line is kept', () => {
    const next = setItemState(parse(day), 1, 'done')
    const item = next.nodes[1]
    assert.equal(item?.kind, 'item')
    assert.equal(item.kind === 'item' && item.time, '10:30')
    assert.equal(item.kind === 'item' && item.note, 'about the queue')
  })

  test('the document it was given is not changed', () => {
    const doc = parse(day)
    setItemState(doc, 1, 'done')
    assert.equal(serialize(doc), day)
  })

  test('a line that is not an item is refused', () => {
    assert.throws(() => setItemState(parse(day), 0, 'done'), /not an item/)
    assert.throws(() => setItemState(parse(day), 99, 'done'), /not an item/)
  })
})

describe('appendItem', () => {
  test('the item lands at the end of the page', () => {
    const next = appendItem(parse(day), createItem('Order the Pi Zero'))
    assert.equal(serialize(next).split('\n').at(-2), '- [ ] Order the Pi Zero')
  })

  test('a day with no file yet gets its first item', () => {
    const next = appendItem(createDayDocument('2026-08-31'), createItem('First'))
    assert.equal(serialize(next), '# 2026-08-31\n\n- [ ] First\n')
  })

  // The daily note lives after the rule, so an item appended to the nodes
  // cannot land inside it.
  test('an item goes above the daily note', () => {
    const withNote = parse('# 2026-08-31\n\n- [ ] One\n\n---\n\nA good day.\n')
    const next = appendItem(withNote, createItem('Two'))
    assert.equal(serialize(next), '# 2026-08-31\n\n- [ ] One\n- [ ] Two\n\n---\n\nA good day.\n')
  })

  test('a blank line at the end of the page stays at the end', () => {
    const next = appendItem(parse('# 2026-08-31\n\n- [ ] One\n\n'), createItem('Two'))
    assert.equal(serialize(next), '# 2026-08-31\n\n- [ ] One\n- [ ] Two\n\n')
  })

  test('the document it was given is not changed', () => {
    const doc = parse(day)
    appendItem(doc, createItem('New'))
    assert.equal(serialize(doc), day)
  })
})

describe('setDailyNote', () => {
  test('writes a note where there was none', () => {
    const next = setDailyNote(parse('# 2026-08-31\n\n- [ ] One\n'), 'Shipped the fix.')
    assert.equal(serialize(next), '# 2026-08-31\n\n- [ ] One\n---\n\nShipped the fix.\n')
  })

  test('replaces a note that was there', () => {
    const next = setDailyNote(parse('# 2026-08-31\n\n---\n\nOld.\n'), 'New.')
    assert.equal(serialize(next), '# 2026-08-31\n\n---\n\nNew.\n')
  })

  // Emptying the note leaves the rule: the rule's presence is the user's, not
  // the app's, and deleting it is how a file used to lose one per save.
  test('emptying the note keeps the rule', () => {
    const next = setDailyNote(parse('# 2026-08-31\n\n---\n\nOld.\n'), '')
    assert.equal(serialize(next), '# 2026-08-31\n\n---\n')
  })
})
