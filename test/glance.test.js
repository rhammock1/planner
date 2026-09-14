// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { SOMEDAY, buildIndex, getPage } from '../src/core/vaultIndex.js'
import { openCount, glance, badge, dayGlances, blank } from '../src/core/glance.js'
import { horizon } from '../src/core/horizon.js'

const TODAY = '2026-08-31'
const LEAD = 7
const BOTH = { count: true, dot: true }

/**
 * @param {Record<string, string>} pages page key -> file text
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function vault(pages) {
  return buildIndex(Object.entries(pages).map(([page, text]) => ({ page, doc: parse(text) })))
}

/**
 * @param {string} body item lines for today
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function today(body) {
  return vault({ [TODAY]: `# ${TODAY}\n\n${body}` })
}

describe('what counts as open', () => {
  test('a day with no file at all counts nothing', () => {
    assert.equal(openCount(null), 0)
  })

  test('only open items count', () => {
    const doc = parse([
      `# ${TODAY}`,
      '',
      '- [ ] Order the connectors',
      '- [x] Send the invoice',
      '- [-] Rewrite the deploy script',
      '- [>] Call the landlord >2026-09-01',
      '',
    ].join('\n'))
    assert.equal(openCount(doc), 1)
  })

  test('lines the parser did not understand are not items', () => {
    const doc = parse(`# ${TODAY}\n\n## Notes\nsomething hand-written\n`)
    assert.equal(openCount(doc), 0)
  })

  test('the count is of today, not of the whole vault', () => {
    const index = vault({
      [TODAY]: `# ${TODAY}\n\n- [ ] Order the connectors\n`,
      '2026-09-04': '# 2026-09-04\n\n- [ ] Book the van\n- [ ] Pack\n',
      [SOMEDAY]: '# Someday\n\n- [ ] Learn to solder properly\n',
    })
    assert.equal(glance(index, TODAY, LEAD).open, 1)
  })
})

describe('the dot', () => {
  test('nothing dated means no dot', () => {
    assert.equal(glance(today('- [ ] Order the connectors\n'), TODAY, LEAD).near, false)
  })

  test('a deadline inside its lead time raises it', () => {
    assert.equal(glance(today('- [ ] Firmware sign-off !2026-09-02\n'), TODAY, LEAD).near, true)
  })

  test('a deadline beyond its lead time does not', () => {
    assert.equal(glance(today('- [ ] Firmware sign-off !2026-09-20\n'), TODAY, LEAD).near, false)
  })

  test('an overdue deadline keeps it up', () => {
    assert.equal(glance(today('- [ ] Firmware sign-off !2026-08-01\n'), TODAY, LEAD).near, true)
  })

  test('a deadline on another page still raises it', () => {
    const index = vault({ [SOMEDAY]: '# Someday\n\n- [ ] Renew the domain !2026-09-02\n' })
    assert.equal(glance(index, TODAY, LEAD).near, true)
  })
})

describe('what the icon carries', () => {
  test('a count and a dot together', () => {
    assert.equal(badge({ open: 3, near: true }, BOTH), '3 •')
  })

  test('a count alone', () => {
    assert.equal(badge({ open: 3, near: false }, BOTH), '3')
  })

  test('a dot alone, when the day is clear but something is coming', () => {
    assert.equal(badge({ open: 0, near: true }, BOTH), '•')
  })

  // A `0` beside the icon is a number to read and then dismiss. Nothing
  // beside the icon is a day with nothing left in it, read without stopping.
  test('nothing left leaves the icon bare', () => {
    assert.equal(badge({ open: 0, near: false }, BOTH), null)
  })

  test('the count setting turns the number off on its own', () => {
    assert.equal(badge({ open: 3, near: true }, { count: false, dot: true }), '•')
  })

  test('the dot setting turns the dot off on its own', () => {
    assert.equal(badge({ open: 3, near: true }, { count: true, dot: false }), '3')
  })

  test('both off is a bare icon whatever the day holds', () => {
    assert.equal(badge({ open: 3, near: true }, { count: false, dot: false }), null)
  })
})

describe('what a day amounts to', () => {
  const YESTERDAY = '2026-08-30'

  /** @returns {import('../src/core/vaultIndex.js').VaultIndex} */
  function mixed() {
    return vault({
      [YESTERDAY]: [
        `# ${YESTERDAY}`,
        '',
        '- [x] Send the invoice',
        '- [-] Rewrite the deploy script',
        `- [>] Call the landlord >${TODAY}`,
        '',
      ].join('\n'),
      [TODAY]: [
        `# ${TODAY}`,
        '',
        '- [ ] Order the connectors',
        '- [ ] Call the landlord',
        '- [x] Book the van',
        '- [ ] Firmware sign-off !2026-09-02',
        '- [ ] Renew the domain !2026-08-01',
        '',
      ].join('\n'),
      '2026-09-20': '# 2026-09-20\n\n- [ ] Pack\n',
    })
  }

  test('open and done are counted, per page', () => {
    const counted = dayGlances(mixed(), TODAY, LEAD)
    assert.equal(counted.get(TODAY)?.open, 4)
    assert.equal(counted.get(TODAY)?.done, 1)
    assert.equal(counted.get(YESTERDAY)?.done, 1)
  })

  // A dropped line was decided against and a migrated one has been copied onto
  // another day, where the copy is what is still owed.
  test('a dropped line and a migrated one are neither open nor done', () => {
    const day = dayGlances(mixed(), TODAY, LEAD).get(YESTERDAY)
    assert.equal(day?.open, 0)
    assert.equal(day?.done, 1)
  })

  test('a deadline inside its lead time is due, and a passed one is overdue', () => {
    const day = dayGlances(mixed(), TODAY, LEAD).get(TODAY)
    assert.equal(day?.due, 1)
    assert.equal(day?.overdue, 1)
  })

  test('the two are disjoint, and never double-count a line', () => {
    const day = dayGlances(mixed(), TODAY, LEAD).get(TODAY) ?? blank()
    assert.ok(day.due + day.overdue <= day.open)
  })

  // The counts are of a page, but the dates are judged from today - so a
  // deadline further out than its lead time is on its page and in neither
  // column yet.
  test('a deadline beyond its lead time is neither due nor overdue', () => {
    assert.deepEqual(dayGlances(mixed(), TODAY, LEAD).get('2026-09-20'), { ...blank(), open: 1 })
  })

  test('a page holding no items still gets four zeroes', () => {
    const index = vault({ [TODAY]: `# ${TODAY}\n\n## Notes\nhand-written\n` })
    assert.deepEqual(dayGlances(index, TODAY, LEAD).get(TODAY), blank())
  })

  test('a day with no file at all is absent, and blank() is what to read then', () => {
    const counted = dayGlances(mixed(), TODAY, LEAD)
    assert.equal(counted.get('2026-07-04'), undefined)
    assert.deepEqual(blank(), { open: 0, done: 0, due: 0, overdue: 0 })
  })

  test('the back page is counted like any other', () => {
    const index = vault({ [SOMEDAY]: '# Someday\n\n- [ ] Learn to solder\n' })
    assert.equal(dayGlances(index, TODAY, LEAD).get(SOMEDAY)?.open, 1)
  })
})

// The whole reason these counts live in core: several places on screen say a
// number about a day, and none of them may disagree with another.
describe('nobody disagrees about a count', () => {
  const index = vault({
    [TODAY]: `# ${TODAY}\n\n- [ ] Order the connectors\n- [x] Send the invoice\n- [ ] Renew the domain !2026-08-01\n`,
    '2026-09-04': '# 2026-09-04\n\n- [ ] Book the van\n- [ ] Pack\n',
    [SOMEDAY]: '# Someday\n\n- [ ] Learn to solder properly\n',
  })

  test('the footer, the columns and the box read what openCount reads', () => {
    const counted = dayGlances(index, TODAY, LEAD)
    for (const page of counted.keys()) {
      assert.equal(counted.get(page)?.open, openCount(getPage(index, page)), page)
    }
  })

  test('the icon reads what the box reads', () => {
    assert.equal(glance(index, TODAY, LEAD).open, dayGlances(index, TODAY, LEAD).get(TODAY)?.open)
  })

  test('the dot is up exactly when the strip has something in it', () => {
    assert.equal(glance(index, TODAY, LEAD).near, horizon(index, TODAY, LEAD).length > 0)
  })

  test('and is down when the strip is empty', () => {
    const clear = today('- [ ] Order the connectors\n')
    assert.equal(glance(clear, TODAY, LEAD).near, false)
    assert.equal(horizon(clear, TODAY, LEAD).length, 0)
  })
})
