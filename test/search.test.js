// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { SOMEDAY, buildIndex } from '../src/core/vaultIndex.js'
import { search, MOST } from '../src/core/search.js'

/**
 * @param {Record<string, string>} pages page key -> file text
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function vault(pages) {
  return buildIndex(Object.entries(pages).map(([page, text]) => ({ page, doc: parse(text) })))
}

/** @param {ReturnType<typeof search>} result */
const lines = (result) => result.groups.flatMap((group) => group.hits.map((hit) => hit.text))
/** @param {ReturnType<typeof search>} result */
const pages = (result) => result.groups.map((group) => group.page)

describe('what matches', () => {
  const index = vault({
    '2026-08-31': '# 2026-08-31\n\n- [ ] Order the connectors\n- [x] Send the invoice\n',
    '2026-09-01': '# 2026-09-01\n\n- [ ] Chase the connectors again\n',
  })

  test('a word anywhere in the vault', () => {
    assert.deepEqual(lines(search(index, 'connectors')), ['Chase the connectors again', 'Order the connectors'])
  })

  test('case does not matter', () => {
    assert.deepEqual(lines(search(index, 'CONNECTORS')).length, 2)
  })

  test('part of a word matches', () => {
    assert.deepEqual(lines(search(index, 'nnect')).length, 2)
  })

  test('nothing matching finds nothing', () => {
    assert.deepEqual(search(index, 'soldering iron'), { groups: [], found: 0 })
  })

  // Otherwise the whole vault is the result, which is the vault, not a search.
  test('an empty query finds nothing', () => {
    assert.deepEqual(search(index, ''), { groups: [], found: 0 })
    assert.deepEqual(search(index, '   '), { groups: [], found: 0 })
  })

  test('a done line is still findable', () => {
    assert.deepEqual(lines(search(index, 'invoice')), ['Send the invoice'])
  })
})

describe('what a line is', () => {
  test('a line the parser did not understand is findable too', () => {
    const index = vault({ '2026-08-31': '# 2026-08-31\n\n## Rough notes\n' })
    assert.deepEqual(lines(search(index, 'rough')), ['## Rough notes'])
  })

  test("the day's own note is findable", () => {
    const index = vault({ '2026-08-31': '# 2026-08-31\n\n- [ ] Something\n\n---\n\nA long day.\n' })
    const found = search(index, 'long day')
    assert.deepEqual(lines(found), ['A long day.'])
    assert.equal(found.groups[0]?.hits[0]?.index, -1, 'a note has no line to jump to')
  })

  // Two results pointing at one line is two things to read and one to press.
  test("an item's note is part of the item, not a result of its own", () => {
    const index = vault({ '2026-08-31': '# 2026-08-31\n\n- [ ] Call the bank\n  > ask about the fee\n' })
    assert.deepEqual(lines(search(index, 'fee')), ['Call the bank ask about the fee'])
  })

  test('a blank line is not a match for a space', () => {
    const index = vault({ '2026-08-31': '# 2026-08-31\n\n- [ ] Something\n\n\n' })
    assert.deepEqual(search(index, ' ').found, 0)
  })

  // What you typed is what you can look for, even though the page does not
  // show it as text any more.
  test('a token is matched as the text that was typed', () => {
    const index = vault({ '2026-08-31': '# 2026-08-31\n\n- [ ] Ship it !2026-09-04\n' })
    assert.equal(search(index, '!2026-09-04').found, 1)
    assert.equal(search(index, '@').found, 0, 'nothing on the page carries a time')
  })

  test('but the result reads the way the page does', () => {
    const index = vault({ '2026-08-31': '# 2026-08-31\n\n- [ ] Ship it !2026-09-04\n' })
    assert.deepEqual(lines(search(index, '!2026-09-04')), ['Ship it'])
  })
})

describe('the order results come back in', () => {
  test('the newest page first', () => {
    const index = vault({
      '2026-08-20': '# 2026-08-20\n\n- [ ] Connectors\n',
      '2026-09-04': '# 2026-09-04\n\n- [ ] Connectors\n',
      '2026-08-31': '# 2026-08-31\n\n- [ ] Connectors\n',
    })
    assert.deepEqual(pages(search(index, 'connectors')), ['2026-09-04', '2026-08-31', '2026-08-20'])
  })

  // It has no date, so it cannot be sorted among the days.
  test('the back page last', () => {
    const index = vault({
      [SOMEDAY]: '# Someday\n\n- [ ] Connectors\n',
      '2026-08-20': '# 2026-08-20\n\n- [ ] Connectors\n',
    })
    assert.deepEqual(pages(search(index, 'connectors')), ['2026-08-20', SOMEDAY])
  })

  test('lines keep the order they are in on the page', () => {
    const index = vault({ '2026-08-31': '# 2026-08-31\n\n- [ ] Connectors A\n- [ ] Connectors B\n' })
    assert.deepEqual(lines(search(index, 'connectors')), ['Connectors A', 'Connectors B'])
  })
})

describe('a query that matches too much', () => {
  const many = Array.from({ length: MOST + 20 }, (_, at) => `- [ ] Line ${at} of many`).join('\n')
  const index = vault({ '2026-08-31': `# 2026-08-31\n\n${many}\n` })

  test('only so many come back', () => {
    assert.equal(lines(search(index, 'of many')).length, MOST)
  })

  // So the page can say the query is the thing to change, not the list.
  test('but the count is of everything found', () => {
    assert.equal(search(index, 'of many').found, MOST + 20)
  })
})
