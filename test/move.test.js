import { test } from 'node:test'
import assert from 'node:assert/strict'

import { moveItem } from '../src/core/move.js'
import { buildIndex } from '../src/core/vaultIndex.js'
import { parse } from '../src/core/parse.js'
import { serialize } from '../src/core/serialize.js'

const TODAY = '2026-09-01'

/**
 * @param {Record<string, string>} pages
 */
function vaultOf(pages) {
  return buildIndex(Object.entries(pages).map(([page, text]) => ({ page, doc: parse(text) })))
}

/** @param {{page: string, doc: import('../src/core/model.js').Document}[]} writes */
function textOf(writes) {
  return Object.fromEntries(writes.map((write) => [write.page, serialize(write.doc)]))
}

const WEEK = {
  '2026-09-02': '# 2026-09-02\n\n- [ ] Call the vet @09:00\n  > ask about the booster\n- [ ] Sand the shelf\n',
  '2026-09-04': '# 2026-09-04\n\n- [ ] Post the forms\n',
}

test('moveItem', async (t) => {
  await t.test('takes the line off a day that has not happened yet', () => {
    const written = textOf(moveItem(vaultOf(WEEK), '2026-09-02', 2, '2026-09-04', TODAY))
    assert.equal(written['2026-09-02'], '# 2026-09-02\n\n- [ ] Call the vet @09:00\n  > ask about the booster\n')
  })

  await t.test('puts it on the destination, at the bottom', () => {
    const written = textOf(moveItem(vaultOf(WEEK), '2026-09-02', 2, '2026-09-04', TODAY))
    assert.equal(written['2026-09-04'], '# 2026-09-04\n\n- [ ] Post the forms\n- [ ] Sand the shelf\n')
  })

  await t.test('carries the time, the deadline, the lead and the note with it', () => {
    const vault = vaultOf({
      '2026-09-02': '# 2026-09-02\n\n- [ ] Call the vet @09:00 !2026-09-08 ~3d\n  > ask about the booster\n',
      '2026-09-04': '# 2026-09-04\n\n',
    })
    const written = textOf(moveItem(vault, '2026-09-02', 1, '2026-09-04', TODAY))
    assert.equal(
      written['2026-09-04'],
      '# 2026-09-04\n\n- [ ] Call the vet @09:00 !2026-09-08 ~3d\n  > ask about the booster\n',
    )
  })

  await t.test('leaves a record on a day that has already been', () => {
    const vault = vaultOf({
      '2026-08-28': '# 2026-08-28\n\n- [ ] Chase the invoice\n',
      '2026-09-02': '# 2026-09-02\n\n',
    })
    const written = textOf(moveItem(vault, '2026-08-28', 1, '2026-09-02', TODAY))
    assert.equal(written['2026-08-28'], '# 2026-08-28\n\n- [>] Chase the invoice >2026-09-02\n')
    assert.equal(written['2026-09-02'], '# 2026-09-02\n\n- [ ] Chase the invoice\n')
  })

  await t.test('treats today as not yet gone', () => {
    const vault = vaultOf({
      [TODAY]: `# ${TODAY}\n\n- [ ] Ring the bank\n`,
      '2026-09-04': '# 2026-09-04\n',
    })
    const written = textOf(moveItem(vault, TODAY, 1, '2026-09-04', TODAY))
    // The blank line under the header is the user's, and stays (spec §3.4).
    assert.equal(written[TODAY], `# ${TODAY}\n\n`)
  })

  await t.test('writes the destination before the source', () => {
    const writes = moveItem(vaultOf(WEEK), '2026-09-02', 2, '2026-09-04', TODAY)
    assert.deepEqual(writes.map((write) => write.page), ['2026-09-04', '2026-09-02'])
  })

  await t.test('makes the destination page when it does not exist yet', () => {
    const written = textOf(moveItem(vaultOf(WEEK), '2026-09-02', 2, '2026-09-05', TODAY))
    assert.equal(written['2026-09-05'], '# 2026-09-05\n\n- [ ] Sand the shelf\n')
  })

  await t.test('sends a line to the back page', () => {
    const written = textOf(moveItem(vaultOf(WEEK), '2026-09-02', 2, 'someday', TODAY))
    assert.equal(written['someday'], '# Someday\n\n- [ ] Sand the shelf\n')
  })

  await t.test('records a line sent to the back page from a day gone by, without a date', () => {
    const vault = vaultOf({ '2026-08-28': '# 2026-08-28\n\n- [ ] Chase the invoice\n' })
    const written = textOf(moveItem(vault, '2026-08-28', 1, 'someday', TODAY))
    assert.equal(written['2026-08-28'], '# 2026-08-28\n\n- [>] Chase the invoice\n')
  })

  await t.test('brings a line back from the back page onto a day', () => {
    const vault = vaultOf({
      someday: '# Someday\n\n- [ ] Rebuild the deck railing\n',
      '2026-09-04': '# 2026-09-04\n\n',
    })
    const written = textOf(moveItem(vault, 'someday', 1, '2026-09-04', TODAY))
    assert.equal(written['someday'], '# Someday\n\n')
    assert.equal(written['2026-09-04'], '# 2026-09-04\n\n- [ ] Rebuild the deck railing\n')
  })

  await t.test('does nothing when the line is dropped where it already is', () => {
    assert.deepEqual(moveItem(vaultOf(WEEK), '2026-09-02', 2, '2026-09-02', TODAY), [])
  })

  await t.test('refuses to move a line that is not there', () => {
    assert.throws(() => moveItem(vaultOf(WEEK), '2026-09-02', 12, '2026-09-04', TODAY), /no line at 12/)
    assert.throws(() => moveItem(vaultOf(WEEK), '2026-09-03', 1, '2026-09-04', TODAY), /no line at 1/)
  })

  await t.test('refuses to move a line the parser did not understand', () => {
    const vault = vaultOf({ '2026-09-02': '# 2026-09-02\n\nsome loose prose\n' })
    assert.throws(() => moveItem(vault, '2026-09-02', 1, '2026-09-04', TODAY), /no line at 1/)
  })

  await t.test('leaves the rest of both pages exactly as they were', () => {
    const vault = vaultOf({
      '2026-09-02': '# 2026-09-02\n\n<!-- a comment -->\n- [ ] Sand the shelf\n\n---\n\nA fine day.\n',
      '2026-09-04': '# 2026-09-04\n\nloose prose\n- [x] Done already\n',
    })
    const written = textOf(moveItem(vault, '2026-09-02', 2, '2026-09-04', TODAY))
    assert.equal(written['2026-09-02'], '# 2026-09-02\n\n<!-- a comment -->\n\n---\n\nA fine day.\n')
    assert.equal(written['2026-09-04'], '# 2026-09-04\n\nloose prose\n- [x] Done already\n- [ ] Sand the shelf\n')
  })
})
