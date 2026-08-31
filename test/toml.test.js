// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseToml, getPath } from '../src/core/toml.js'

describe('values', () => {
  test('strings, numbers and booleans', () => {
    assert.deepEqual(parseToml('vault = "~/Planner"\nhorizon_lead_days = 7\nmenu_bar_count = true\n'), {
      vault: '~/Planner', horizon_lead_days: 7, menu_bar_count: true,
    })
  })

  test('an empty string is a value, not an absence', () => {
    assert.deepEqual(parseToml('editor = ""\n'), { editor: '' })
  })

  test('negative and fractional numbers', () => {
    assert.deepEqual(parseToml('a = -3\nb = 1.5\n'), { a: -3, b: 1.5 })
  })

  test('arrays of strings', () => {
    assert.deepEqual(parseToml('approved_capabilities = ["macos.calendar.read", "net.fetch"]\n'), {
      approved_capabilities: ['macos.calendar.read', 'net.fetch'],
    })
  })

  test('an empty array', () => {
    assert.deepEqual(parseToml('caps = []\n'), { caps: [] })
  })

  test('escapes inside a string', () => {
    assert.deepEqual(parseToml('a = "say \\"hi\\""\nb = "c:\\\\tmp"\nc = "one\\ntwo"\n'), {
      a: 'say "hi"', b: 'c:\\tmp', c: 'one\ntwo',
    })
  })
})

describe('layout', () => {
  test('comments and blank lines are skipped', () => {
    assert.deepEqual(parseToml('# a note\n\ntheme = "ledger"   # trailing\n'), { theme: 'ledger' })
  })

  // A comment character inside a string is text, not a comment. A theme token
  // is a colour, and every colour starts with one.
  test('a hash inside a string is kept', () => {
    assert.deepEqual(parseToml('paper = "#FBFAF6" # the page\n'), { paper: '#FBFAF6' })
  })

  test('alignment padding is ignored', () => {
    assert.deepEqual(parseToml('vault              = "~/Planner"\ntheme = "ledger"\n'), {
      vault: '~/Planner', theme: 'ledger',
    })
  })

  test('tables and dotted tables nest', () => {
    const text = 'theme = "ledger"\n\n[tokens]\npaper = "#FBFAF6"\n\n[plugins.macos-calendar]\nenabled = true\n'
    assert.deepEqual(parseToml(text), {
      theme: 'ledger',
      tokens: { paper: '#FBFAF6' },
      plugins: { 'macos-calendar': { enabled: true } },
    })
  })

  test('an empty file is an empty table', () => {
    assert.deepEqual(parseToml(''), {})
  })

  test('CRLF line endings parse', () => {
    assert.deepEqual(parseToml('theme = "ledger"\r\n[tokens]\r\npaper = "#FBFAF6"\r\n'), {
      theme: 'ledger', tokens: { paper: '#FBFAF6' },
    })
  })
})

describe('what is refused', () => {
  /** @type {[string, string][]} */
  const cases = [
    ['theme "ledger"\n', 'line 1'],
    ['theme = "ledger\n', 'line 1'],
    ['[tokens\npaper = "x"\n', 'line 1'],
    ['a = \n', 'line 1'],
    ['a = nope\n', 'line 1'],
    ['a = "x"\nb = "y"\na = "z"\n', 'line 3'],
    ['a = "x" trailing\n', 'line 1'],
    ['caps = ["a", 2]\n', 'line 1'],
  ]

  for (const [text, where] of cases) {
    test(`${JSON.stringify(text)} names the line it failed on`, () => {
      assert.throws(() => parseToml(text), new RegExp(where))
    })
  }

  // Two values for one key is not a typo the app can resolve. Guessing which
  // vault path was meant is worse than saying so.
  test('a duplicate key inside a table is refused too', () => {
    assert.throws(() => parseToml('[tokens]\npaper = "a"\npaper = "b"\n'), /line 3/)
  })
})
