// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { serialize } from '../src/core/serialize.js'
import { SOMEDAY, buildIndex, getPage } from '../src/core/vaultIndex.js'
import { unfinished, carryForward } from '../src/core/carry.js'

const TODAY = '2026-08-31'
const SCAN_DAYS = 30

/**
 * @param {Record<string, string>} pages page key -> file text
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function vault(pages) {
  return buildIndex(Object.entries(pages).map(([page, text]) => ({ page, doc: parse(text) })))
}

/**
 * @param {import('../src/core/carry.js').CarryGroup[]} groups
 * @param {'keep'|'drop'} action
 * @returns {import('../src/core/carry.js').CarryDecision[]}
 */
function decideAll(groups, action) {
  return groups.flatMap((group) => group.items.map(
    ({ page, index }) => ({ page, index, action }),
  ))
}

/**
 * @param {{page: string, doc: import('../src/core/model.js').Document}[]} writes
 * @param {string} page
 * @returns {string}
 */
function textOf(writes, page) {
  const write = writes.find((entry) => entry.page === page)
  assert.ok(write, `expected a write for ${page}`)
  return serialize(write.doc)
}

describe('finding what is unfinished', () => {
  test('open items from a past day are unfinished', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Vendor survey\n' })
    const groups = unfinished(index, TODAY, SCAN_DAYS)
    assert.equal(groups.length, 1)
    assert.equal(groups[0]?.from, '2026-08-28')
    assert.deepEqual(groups[0]?.items.map((entry) => entry.item.text), ['Vendor survey'])
  })

  // Once you have kept or dropped a line it is no longer open, which is the
  // whole record of having reviewed the day. Nothing else marks a page read.
  test('a day whose items are all settled produces no group', () => {
    const index = vault({
      '2026-08-28': '# 2026-08-28\n\n- [x] Standup\n- [-] Survey\n- [>] Moved >2026-08-29\n',
    })
    assert.deepEqual(unfinished(index, TODAY, SCAN_DAYS), [])
  })

  test('today and the future are left alone', () => {
    const index = vault({
      [TODAY]: `# ${TODAY}\n\n- [ ] Today's work\n`,
      '2026-09-02': '# 2026-09-02\n\n- [ ] Future work\n',
    })
    assert.deepEqual(unfinished(index, TODAY, SCAN_DAYS), [])
  })

  test('the back page never rots', () => {
    const index = vault({ [SOMEDAY]: '# Someday\n\n- [ ] Rebuild the deck railing\n' })
    assert.deepEqual(unfinished(index, TODAY, SCAN_DAYS), [])
  })

  test('groups are most recent first', () => {
    const index = vault({
      '2026-08-25': '# 2026-08-25\n\n- [ ] Older\n',
      '2026-08-28': '# 2026-08-28\n\n- [ ] Newer\n',
    })
    assert.deepEqual(unfinished(index, TODAY, SCAN_DAYS).map((g) => g.from), [
      '2026-08-28', '2026-08-25',
    ])
  })

  test('the scan stops at the cap', () => {
    const index = vault({
      '2026-08-01': '# 2026-08-01\n\n- [ ] Just inside\n',
      '2026-07-31': '# 2026-07-31\n\n- [ ] Just outside\n',
    })
    assert.deepEqual(unfinished(index, TODAY, SCAN_DAYS).map((g) => g.from), ['2026-08-01'])
  })

  test('days with no file are skipped without cost', () => {
    const index = vault({ '2026-08-30': '# 2026-08-30\n\n- [ ] Yesterday\n' })
    assert.equal(unfinished(index, TODAY, 3650).length, 1)
  })
})

describe('keeping an item', () => {
  const source = '# 2026-08-28\n\n- [ ] Firmware sign-off @10:30 !2026-09-02 ~10d\n  > ask about the timeout\n'

  test('the source line records where it went', () => {
    const index = vault({ '2026-08-28': source })
    const writes = carryForward(index, TODAY, decideAll(unfinished(index, TODAY, SCAN_DAYS), 'keep'))
    assert.equal(
      textOf(writes, '2026-08-28'),
      '# 2026-08-28\n\n- [>] Firmware sign-off @10:30 !2026-09-02 ~10d >2026-08-31\n  > ask about the timeout\n',
    )
  })

  test('the item arrives on today whole', () => {
    const index = vault({ '2026-08-28': source })
    const writes = carryForward(index, TODAY, decideAll(unfinished(index, TODAY, SCAN_DAYS), 'keep'))
    assert.equal(
      textOf(writes, TODAY),
      '# 2026-08-31\n\n- [ ] Firmware sign-off @10:30 !2026-09-02 ~10d\n  > ask about the timeout\n',
    )
  })

  test('it lands after what today already holds', () => {
    const index = vault({
      '2026-08-28': '# 2026-08-28\n\n- [ ] Carried\n',
      [TODAY]: `# ${TODAY}\n\n- [ ] Already here\n`,
    })
    const writes = carryForward(index, TODAY, decideAll(unfinished(index, TODAY, SCAN_DAYS), 'keep'))
    assert.equal(textOf(writes, TODAY), `# ${TODAY}\n\n- [ ] Already here\n- [ ] Carried\n`)
  })

  test('items from several days arrive oldest first', () => {
    const index = vault({
      '2026-08-25': '# 2026-08-25\n\n- [ ] Older\n',
      '2026-08-28': '# 2026-08-28\n\n- [ ] Newer\n',
    })
    const writes = carryForward(index, TODAY, decideAll(unfinished(index, TODAY, SCAN_DAYS), 'keep'))
    assert.equal(textOf(writes, TODAY), `# ${TODAY}\n\n- [ ] Older\n- [ ] Newer\n`)
  })
})

describe('dropping an item', () => {
  test('the source line records that it was dropped, and nothing moves', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Vendor survey\n' })
    const writes = carryForward(index, TODAY, decideAll(unfinished(index, TODAY, SCAN_DAYS), 'drop'))
    assert.equal(textOf(writes, '2026-08-28'), '# 2026-08-28\n\n- [-] Vendor survey\n')
    assert.equal(writes.length, 1)
  })
})

describe('the writes themselves', () => {
  test('today is written before any source is rewritten', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Carried\n' })
    const writes = carryForward(index, TODAY, decideAll(unfinished(index, TODAY, SCAN_DAYS), 'keep'))
    assert.deepEqual(writes.map((write) => write.page), [TODAY, '2026-08-28'])
  })

  test('a day with no file yet is created', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Carried\n' })
    assert.equal(getPage(index, TODAY), null)
    const writes = carryForward(index, TODAY, decideAll(unfinished(index, TODAY, SCAN_DAYS), 'keep'))
    assert.equal(textOf(writes, TODAY), `# ${TODAY}\n\n- [ ] Carried\n`)
  })

  test('the documents in the index are not touched', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Carried\n' })
    const before = serialize(/** @type {any} */ (getPage(index, '2026-08-28')))
    carryForward(index, TODAY, decideAll(unfinished(index, TODAY, SCAN_DAYS), 'keep'))
    assert.equal(serialize(/** @type {any} */ (getPage(index, '2026-08-28'))), before)
  })

  test('nothing decided is nothing written', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Carried\n' })
    assert.deepEqual(carryForward(index, TODAY, []), [])
  })

  test('a partial decision leaves the undecided lines open', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Keep me\n- [ ] Leave me\n' })
    const groups = unfinished(index, TODAY, SCAN_DAYS)
    const first = groups[0]?.items[0]
    assert.ok(first)
    const writes = carryForward(index, TODAY, [{ page: first.page, index: first.index, action: 'keep' }])
    assert.equal(
      textOf(writes, '2026-08-28'),
      '# 2026-08-28\n\n- [>] Keep me >2026-08-31\n- [ ] Leave me\n',
    )
  })
})

describe('a decision that does not address an item', () => {
  test('a missing page is an error, not a silent no-op', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Carried\n' })
    assert.throws(
      () => carryForward(index, TODAY, [{ page: '2026-08-27', index: 1, action: 'keep' }]),
      /2026-08-27/,
    )
  })

  test('an index that is not an item is an error', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Carried\n' })
    assert.throws(
      () => carryForward(index, TODAY, [{ page: '2026-08-28', index: 0, action: 'keep' }]),
      /not an item/,
    )
  })
})

describe('several decisions on one page', () => {
  test('every decided line is rewritten', () => {
    const index = vault({ '2026-08-28': '# 2026-08-28\n\n- [ ] Keep me\n- [ ] Drop me\n- [ ] Leave me\n' })
    const items = unfinished(index, TODAY, SCAN_DAYS)[0]?.items ?? []
    const [keep, drop] = items
    assert.ok(keep && drop)
    const writes = carryForward(index, TODAY, [
      { page: drop.page, index: drop.index, action: 'drop' },
      { page: keep.page, index: keep.index, action: 'keep' },
    ])
    assert.equal(
      textOf(writes, '2026-08-28'),
      '# 2026-08-28\n\n- [>] Keep me >2026-08-31\n- [-] Drop me\n- [ ] Leave me\n',
    )
    assert.equal(textOf(writes, TODAY), `# ${TODAY}\n\n- [ ] Keep me\n`)
  })

  // Today is the destination. Accepting it as a source too would put one page
  // in the write list twice, and the second write would clobber the first.
  test('carrying today onto itself is refused', () => {
    const index = vault({ [TODAY]: `# ${TODAY}\n\n- [ ] Already here\n` })
    assert.throws(
      () => carryForward(index, TODAY, [{ page: TODAY, index: 1, action: 'keep' }]),
      /itself/,
    )
  })
})
