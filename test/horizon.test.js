// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { SOMEDAY, buildIndex } from '../src/core/vaultIndex.js'
import { horizon } from '../src/core/horizon.js'

const TODAY = '2026-08-31'
const DEFAULT_LEAD = 7

/**
 * @param {Record<string, string>} pages page key -> file text
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function vault(pages) {
  return buildIndex(Object.entries(pages).map(([page, text]) => ({ page, doc: parse(text) })))
}

/**
 * @param {string} body item lines for a single day
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function today(body) {
  return vault({ [TODAY]: `# ${TODAY}\n\n${body}` })
}

/** @param {ReturnType<typeof horizon>} entries */
const texts = (entries) => entries.map((entry) => entry.item.text)

describe('what enters the strip', () => {
  test('an item due inside its lead time is in', () => {
    const index = today('- [ ] Firmware sign-off !2026-09-02\n')
    assert.deepEqual(texts(horizon(index, TODAY, DEFAULT_LEAD)), ['Firmware sign-off'])
  })

  test('an item due beyond its lead time is out', () => {
    const index = today('- [ ] Firmware sign-off !2026-09-20\n')
    assert.deepEqual(horizon(index, TODAY, DEFAULT_LEAD), [])
  })

  test('an item lands exactly on the boundary day', () => {
    const index = today('- [ ] Boundary !2026-09-07\n')
    assert.equal(horizon(index, TODAY, DEFAULT_LEAD).length, 1)
    assert.equal(horizon(index, TODAY, 6).length, 0)
  })

  test('a per-item lead overrides the default in both directions', () => {
    const far = today('- [ ] Firmware sign-off !2026-09-20 ~30d\n')
    assert.equal(horizon(far, TODAY, DEFAULT_LEAD).length, 1)

    const near = today('- [ ] Firmware sign-off !2026-09-02 ~1d\n')
    assert.equal(horizon(near, TODAY, DEFAULT_LEAD).length, 0)
  })

  test('an item with no due date is never in', () => {
    const index = today('- [ ] Pair with Dana @10:30\n')
    assert.deepEqual(horizon(index, TODAY, DEFAULT_LEAD), [])
  })

  test('an overdue item stays in however long it has been overdue', () => {
    const index = today('- [ ] Vendor survey !2025-01-01 ~1d\n')
    const [entry] = horizon(index, TODAY, DEFAULT_LEAD)
    assert.ok(entry)
    assert.equal(entry.overdue, true)
  })

  // A deadline you have dealt with is not a deadline. Migrated items are
  // handled too: the copy carried forward holds the due date now, and showing
  // both would double every carried deadline in the strip.
  test('only open items are in', () => {
    const index = today([
      '- [x] Done !2026-09-01\n',
      '- [-] Dropped !2026-09-01\n',
      '- [>] Migrated !2026-09-01 >2026-09-01\n',
      '- [ ] Open !2026-09-01\n',
    ].join(''))
    assert.deepEqual(texts(horizon(index, TODAY, DEFAULT_LEAD)), ['Open'])
  })
})

describe('where the items come from', () => {
  test('deadlines are collected from every page in the vault', () => {
    const index = vault({
      '2026-08-20': '# 2026-08-20\n\n- [ ] From the past !2026-09-03\n',
      [TODAY]: `# ${TODAY}\n\n- [ ] From today !2026-09-02\n`,
      '2026-09-10': '# 2026-09-10\n\n- [ ] From the future !2026-09-01\n',
      [SOMEDAY]: '# Someday\n\n- [ ] From the back page !2026-09-04\n',
    })
    assert.deepEqual(texts(horizon(index, TODAY, DEFAULT_LEAD)), [
      'From the future', 'From today', 'From the past', 'From the back page',
    ])
  })
})

describe('order', () => {
  test('soonest first, with overdue ahead of everything', () => {
    const index = today([
      '- [ ] Third !2026-09-05\n',
      '- [ ] First !2026-08-29\n',
      '- [ ] Second !2026-08-31\n',
    ].join(''))
    assert.deepEqual(texts(horizon(index, TODAY, DEFAULT_LEAD)), ['First', 'Second', 'Third'])
  })

  // The strip marquees. Two items sharing a due date must not swap places
  // between renders, or the band jitters.
  test('items sharing a due date hold file order', () => {
    const index = vault({
      '2026-08-30': '# 2026-08-30\n\n- [ ] Yesterday page !2026-09-01\n',
      [TODAY]: `# ${TODAY}\n\n- [ ] First on page !2026-09-01\n- [ ] Second on page !2026-09-01\n`,
    })
    assert.deepEqual(texts(horizon(index, TODAY, DEFAULT_LEAD)), [
      'Yesterday page', 'First on page', 'Second on page',
    ])
  })
})

describe('what each entry carries', () => {
  test('the address, the due date, and the days left', () => {
    const index = today('- [ ] Firmware sign-off !2026-09-02\n')
    const [entry] = horizon(index, TODAY, DEFAULT_LEAD)
    assert.ok(entry)
    assert.equal(entry.page, TODAY)
    assert.equal(entry.index, 1)
    assert.equal(entry.item.text, 'Firmware sign-off')
    assert.equal(entry.due, '2026-09-02')
    assert.equal(entry.daysRemaining, 2)
    assert.equal(entry.overdue, false)
  })

  test('due today is not overdue', () => {
    const index = today(`- [ ] Due now !${TODAY}\n`)
    const [entry] = horizon(index, TODAY, DEFAULT_LEAD)
    assert.ok(entry)
    assert.equal(entry.daysRemaining, 0)
    assert.equal(entry.overdue, false)
  })

  test('yesterday is overdue by a day', () => {
    const index = today('- [ ] Late !2026-08-30\n')
    const [entry] = horizon(index, TODAY, DEFAULT_LEAD)
    assert.ok(entry)
    assert.equal(entry.daysRemaining, -1)
    assert.equal(entry.overdue, true)
  })
})
