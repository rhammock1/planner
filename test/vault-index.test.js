// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import {
  SOMEDAY, buildIndex, getPage, pageKeys, items, withPage, pathFor, pageForPath,
} from '../src/core/vaultIndex.js'

const monday = '# 2026-08-31\n\n- [ ] Pair with Dana @10:30\n- [x] Standup\n'
const tuesday = '# 2026-09-01\n\n- [ ] Order the Pi Zero\n'
const backPage = '# Someday\n\n- [ ] Rebuild the deck railing\n'

/** @returns {Map<string, import('../src/core/model.js').Document>} */
function sampleVault() {
  return buildIndex([
    { page: '2026-09-01', doc: parse(tuesday) },
    { page: '2026-08-31', doc: parse(monday) },
    { page: SOMEDAY, doc: parse(backPage) },
  ])
}

describe('building and reading', () => {
  test('a page comes back as it went in', () => {
    const index = sampleVault()
    assert.equal(getPage(index, '2026-08-31')?.date, '2026-08-31')
    assert.equal(getPage(index, SOMEDAY)?.kind, 'someday')
  })

  test('a page with no file is null, not an error', () => {
    assert.equal(getPage(sampleVault(), '2026-07-04'), null)
  })

  test('an empty vault is a valid index', () => {
    const index = buildIndex([])
    assert.deepEqual(pageKeys(index), [])
    assert.deepEqual(items(index), [])
  })
})

describe('ordering', () => {
  // Days ascending gives the week and month views their natural order; the
  // back page has no date, so it can only sit at one end. Last is where it
  // sits in the footer, so last is where it sits here.
  test('days sort ascending with the back page last', () => {
    assert.deepEqual(pageKeys(sampleVault()), ['2026-08-31', '2026-09-01', SOMEDAY])
  })

  test('items come back in page order, then file order', () => {
    const found = items(sampleVault()).map((entry) => entry.item.text)
    assert.deepEqual(found, [
      'Pair with Dana', 'Standup', 'Order the Pi Zero', 'Rebuild the deck railing',
    ])
  })
})

describe('item references', () => {
  // Identity is (page, index-within-file) per spec §3.5, and the index is the
  // position in doc.nodes - the address a write needs to replace the line.
  test('a reference addresses the node it came from', () => {
    const index = sampleVault()
    const standup = items(index).find((entry) => entry.item.text === 'Standup')
    assert.ok(standup)
    assert.equal(standup.page, '2026-08-31')
    assert.equal(getPage(index, '2026-08-31')?.nodes[standup.index], standup.item)
  })

  test('opaque lines are skipped but still occupy their index', () => {
    const index = buildIndex([{ page: '2026-08-31', doc: parse(monday) }])
    const [first] = items(index)
    assert.ok(first)
    assert.equal(first.index, 1)
  })
})

describe('replacing a page', () => {
  test('the new index has the new document and the old one is untouched', () => {
    const before = sampleVault()
    const after = withPage(before, '2026-08-31', parse('# 2026-08-31\n\n- [ ] Something else\n'))
    assert.equal(getPage(after, '2026-08-31')?.nodes.length, 2)
    assert.equal(items(before).length, 4)
    assert.notEqual(before, after)
  })

  test('a deleted file drops out of the index', () => {
    const after = withPage(sampleVault(), '2026-09-01', null)
    assert.equal(getPage(after, '2026-09-01'), null)
    assert.deepEqual(pageKeys(after), ['2026-08-31', SOMEDAY])
  })

  test('a page the index has never seen is added', () => {
    const after = withPage(buildIndex([]), '2026-09-02', parse('# 2026-09-02\n'))
    assert.deepEqual(pageKeys(after), ['2026-09-02'])
  })
})

describe('paths', () => {
  test('a day maps to its year and month folders', () => {
    assert.equal(pathFor('2026-08-31'), '2026/08/2026-08-31.md')
    assert.equal(pathFor('2027-01-01'), '2027/01/2027-01-01.md')
  })

  test('the back page sits at the vault root', () => {
    assert.equal(pathFor(SOMEDAY), 'someday.md')
  })

  test('a path maps back to its page', () => {
    assert.equal(pageForPath('2026/08/2026-08-31.md'), '2026-08-31')
    assert.equal(pageForPath('someday.md'), SOMEDAY)
  })

  // The watcher reports absolute paths; the leading vault directory is not
  // this module's business.
  test('a leading directory is ignored', () => {
    assert.equal(pageForPath('/Users/rob/Planner/2026/08/2026-08-31.md'), '2026-08-31')
    assert.equal(pageForPath('/Users/rob/Planner/someday.md'), SOMEDAY)
  })

  test('every page key survives a round trip through its path', () => {
    for (const page of ['2026-08-31', '2024-02-29', SOMEDAY]) {
      assert.equal(pageForPath(pathFor(page)), page)
    }
  })

  test('anything else in the vault is not a page', () => {
    assert.equal(pageForPath('README.md'), null)
    assert.equal(pageForPath('2026/08/notes.md'), null)
    assert.equal(pageForPath('2026/08/2026-08-31.txt'), null)
    assert.equal(pageForPath('2026/08/2026-02-30.md'), null)
    assert.equal(pageForPath('someday.md.bak'), null)
  })

  // A file filed under the wrong month would give one date two homes, and
  // writes would land in whichever the caller happened to compute.
  test('a day filed under folders that disagree with it is not a page', () => {
    assert.equal(pageForPath('2026/09/2026-08-31.md'), null)
    assert.equal(pageForPath('2025/08/2026-08-31.md'), null)
  })
})
