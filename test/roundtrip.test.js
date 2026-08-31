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
  for (const name of ['day-canonical.md', 'someday.md', 'day-frontmatter.md']) {
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
