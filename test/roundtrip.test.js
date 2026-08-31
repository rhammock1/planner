// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/core/parse.js'
import { serialize } from '../src/core/serialize.js'
import { markFor, ITEM_STATES } from '../src/core/model.js'

/** @param {string} name */
const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

describe('canonical fixtures round-trip byte-for-byte', () => {
  for (const name of ['day-canonical.md', 'someday.md', 'day-frontmatter.md', 'day-trailing-rule.md']) {
    test(name, () => {
      const original = fixture(name)
      assert.equal(serialize(parse(original)), original)
    })
  }
})

describe('non-canonical input becomes canonical and then stays put', () => {
  test('day-messy.md is stable after one pass', () => {
    const once = serialize(parse(fixture('day-messy.md')))
    const twice = serialize(parse(once))
    assert.equal(twice, once)
  })

  test('canonicalisation fixes case, token order, and padding', () => {
    const once = serialize(parse(fixture('day-messy.md')))
    assert.match(once, /^- \[x\] Shouting done$/m)
    assert.match(once, /^- \[ \] Tokens out of order @08:05 !2026-09-04 ~3d$/m)
  })

  test('content the parser does not understand survives untouched', () => {
    const once = serialize(parse(fixture('day-messy.md')))
    assert.match(once, /^\| col \| col \|$/m)
    assert.match(once, /^Some prose that is not a task at all\.$/m)
    assert.match(once, /^- just a bullet$/m)
    assert.match(once, /^- \[ \] Email dana@gotab\.io about the 5~10 range$/m)
  })
})

describe('generated documents are stable', () => {
  // A small deterministic generator beats a random one here: a failure names
  // the exact document that broke, and reruns reproduce it.
  const texts = ['', 'plain', 'has — an em dash', 'trailing tokens @09:00']
  const times = [null, '08:05', '23:59']
  const dues = [null, '2026-09-02']
  const notes = [null, '', 'one', 'one\ntwo']

  test('every combination survives two passes unchanged', () => {
    let count = 0
    for (const state of ITEM_STATES) {
      for (const text of texts) {
        for (const time of times) {
          for (const due of dues) {
            for (const note of notes) {
              const source = [
                '# 2026-08-31',
                `- [${markFor(state)}] ${[text, time && `@${time}`, due && `!${due}`]
                  .filter(Boolean).join(' ')}`.trimEnd(),
                ...(note === null ? [] : note.split('\n').map((l) => (l === '' ? '  >' : `  > ${l}`))),
              ].join('\n') + '\n'

              const once = serialize(parse(source))
              const twice = serialize(parse(once))
              assert.equal(twice, once, `unstable for:\n${source}`)
              count += 1
            }
          }
        }
      }
    }
    assert.equal(count, 4 * 4 * 3 * 2 * 4)
  })
})

describe('a daily-note rule survives the round trip', () => {
  test('a file ending in a bare rule keeps it', () => {
    const src = '# 2026-08-31\n- [ ] a\n---\n'
    assert.equal(serialize(parse(src)), src)
  })

  test('repeated saves do not erode stacked rules', () => {
    // Regression for C1: rules were consumed one per save until none remained.
    let text = '# 2026-08-31\n- [ ] a\n---\n---\n---\n'
    const first = serialize(parse(text))
    for (let i = 0; i < 5; i += 1) text = serialize(parse(text))
    assert.equal(text, first)
    assert.match(text, /---\n---\n---\n$/)
  })

  test('a rule with a note still round-trips', () => {
    const src = '# 2026-08-31\n- [ ] a\n\n---\n\nLong day.\n'
    assert.equal(serialize(parse(src)), src)
  })

  test('a file with no rule gains none', () => {
    const src = '# 2026-08-31\n- [ ] a\n'
    assert.equal(serialize(parse(src)), src)
  })

  test('a CRLF file is normalised to LF once and then holds', () => {
    const once = serialize(parse('# 2026-08-31\r\n\r\n- [ ] a\r\n'))
    assert.equal(once, '# 2026-08-31\n\n- [ ] a\n')
    assert.equal(serialize(parse(once)), once)
  })
})

describe('golden parse output', () => {
  // Stability tests prove the format does not drift; only a pinned expected
  // structure proves the parse is CORRECT. C1 shipped because nothing here
  // asserted values.
  test('day-canonical.md parses to the expected structure', () => {
    const doc = parse(fixture('day-canonical.md'))
    assert.equal(doc.kind, 'day')
    assert.equal(doc.date, '2026-08-31')
    assert.equal(doc.frontmatter, null)
    assert.equal(doc.dailyNote, 'Shipped the retry fix. The offline queue finally makes sense.')

    const items = doc.nodes.filter((n) => n.kind === 'item')
    assert.equal(items.length, 6)
    assert.deepEqual(items.map((i) => i.state),
      ['done', 'open', 'open', 'open', 'migrated', 'dropped'])
    assert.equal(items[1]?.time, '10:30')
    assert.equal(items[2]?.note, 'ask about the 30s timeout')
    assert.equal(items[3]?.due, '2026-09-02')
    assert.equal(items[3]?.lead, 10)
    assert.equal(items[4]?.movedTo, '2026-09-01')
  })

  test('day-frontmatter.md parses to the expected structure', () => {
    const doc = parse(fixture('day-frontmatter.md'))
    assert.deepEqual(doc.frontmatter, ['tags: work', 'project: planner'])
    assert.equal(doc.kind, 'day')
    assert.equal(doc.date, '2026-09-07')
    assert.equal(doc.dailyNote, 'Frontmatter survived.')
    assert.equal(doc.nodes.filter((n) => n.kind === 'item').length, 2)
  })

  test('day-trailing-rule.md keeps an empty, present daily note', () => {
    const doc = parse(fixture('day-trailing-rule.md'))
    assert.equal(doc.dailyNote, '')
    assert.equal(doc.nodes.filter((n) => n.kind === 'item').length, 1)
  })
})
