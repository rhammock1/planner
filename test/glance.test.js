// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { SOMEDAY, buildIndex } from '../src/core/vaultIndex.js'
import { openCount, glance, badge } from '../src/core/glance.js'

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
