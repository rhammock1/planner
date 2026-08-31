// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TOKEN_NAMES, LEDGER, readTheme, themeCss } from '../src/core/theme.js'

const ledgerFile = new URL('../themes/ledger/theme.toml', import.meta.url)

describe('the token contract', () => {
  test('every documented token has a default', () => {
    for (const name of TOKEN_NAMES) {
      assert.equal(typeof LEDGER.tokens.get(name), 'string', `${name} has no default`)
    }
  })

  test('the contract is the one docs/themes.md publishes', () => {
    const docs = readFileSync(new URL('../docs/themes.md', import.meta.url), 'utf8')
    for (const name of TOKEN_NAMES) {
      assert.match(docs, new RegExp(`\`${name}\``), `${name} is undocumented`)
    }
  })

  // The bundled theme and the built-in fallback have to agree, or the app
  // looks different before the theme folder is read than after.
  test('the bundled Ledger folder matches the built-in default', () => {
    const { theme, notices } = readTheme(readFileSync(ledgerFile, 'utf8'))
    assert.deepEqual(notices, [])
    assert.deepEqual(theme, LEDGER)
  })
})

describe('reading a theme', () => {
  const theme = [
    'name = "Console"\n',
    'author = "Robert Hammock"\n',
    'appearance = "dark"\n',
    '\n',
    '[tokens]\n',
    'paper = "#101418"\n',
    'ink = "#D7E0E8"\n',
  ].join('')

  test('the metadata and the tokens come off the file', () => {
    const { theme: read, notices } = readTheme(theme)
    assert.equal(read.name, 'Console')
    assert.equal(read.author, 'Robert Hammock')
    assert.equal(read.appearance, 'dark')
    assert.equal(read.tokens.get('paper'), '#101418')
    assert.deepEqual(notices, [])
  })

  // A theme that names half the tokens must still render. The rest come from
  // Ledger rather than from nothing.
  test('tokens the theme leaves out fall back to the default', () => {
    const { theme: read } = readTheme(theme)
    assert.equal(read.tokens.get('accent'), LEDGER.tokens.get('accent'))
  })

  test('a theme may define tokens of its own', () => {
    const { theme: read, notices } = readTheme('[tokens]\nrule-line = "#C8C4B6"\n')
    assert.equal(read.tokens.get('rule-line'), '#C8C4B6')
    assert.deepEqual(notices, [])
  })

  test('an unreadable file gives the default theme and says why', () => {
    const { theme: read, notices } = readTheme('name "Console"\n')
    assert.deepEqual(read, LEDGER)
    assert.equal(notices.length, 1)
    assert.match(notices[0] ?? '', /line 1/)
  })

  test('an appearance that is neither light nor dark falls back', () => {
    const { theme: read, notices } = readTheme('appearance = "twilight"\n')
    assert.equal(read.appearance, 'light')
    assert.equal(notices.length, 1)
  })

  test('a token that is not a string is reported and replaced', () => {
    const { theme: read, notices } = readTheme('[tokens]\npaper = 7\n')
    assert.equal(read.tokens.get('paper'), LEDGER.tokens.get('paper'))
    assert.equal(notices.length, 1)
    assert.match(notices[0] ?? '', /paper/)
  })
})

describe('what a token value may contain', () => {
  /** @type {[string, string][]} */
  const refused = [
    ['closing the rule', '#fff } body { display: none'],
    ['ending the declaration', 'red; position: fixed'],
    ['opening a block', 'red { x'],
    ['an import', '#fff @import url(https://example.com/x.css)'],
    ['a remote url', 'url(https://example.com/paper.png)'],
    ['a protocol-relative url', 'url(//example.com/paper.png)'],
    ['leaving the style element', '#fff </style><script>'],
  ]

  for (const [what, value] of refused) {
    test(`${what} is refused`, () => {
      const { theme, notices } = readTheme(`[tokens]\npaper = ${JSON.stringify(value)}\n`)
      assert.equal(theme.tokens.get('paper'), LEDGER.tokens.get('paper'))
      assert.equal(notices.length, 1)
    })
  }

  // Themes never touch the network (spec §6), but a texture shipped in the
  // theme's own folder is exactly what the token is for.
  test('a relative url is allowed', () => {
    const { theme, notices } = readTheme('[tokens]\ntexture = "url(paper.png)"\n')
    assert.equal(theme.tokens.get('texture'), 'url(paper.png)')
    assert.deepEqual(notices, [])
  })

  test('a gradient with commas and parens is allowed', () => {
    const value = 'radial-gradient(#E2DFD4 1px, transparent 1px)'
    const { theme, notices } = readTheme(`[tokens]\ntexture = "${value}"\n`)
    assert.equal(theme.tokens.get('texture'), value)
    assert.deepEqual(notices, [])
  })

  test('a font stack with quotes is allowed', () => {
    const value = "'IBM Plex Mono', monospace"
    const { theme, notices } = readTheme(`[tokens]\nfont-meta = "${value}"\n`)
    assert.equal(theme.tokens.get('font-meta'), value)
    assert.deepEqual(notices, [])
  })
})

describe('the stylesheet', () => {
  test('tokens become custom properties on :root', () => {
    const css = themeCss(LEDGER)
    assert.match(css, /^:root \{$/m)
    assert.match(css, /^ {2}--paper: #FBFAF6;$/m)
    assert.match(css, /^\}$/m)
  })

  test('the appearance drives color-scheme', () => {
    assert.match(themeCss(LEDGER), /^ {2}color-scheme: light;$/m)
    const { theme } = readTheme('appearance = "dark"\n')
    assert.match(themeCss(theme), /^ {2}color-scheme: dark;$/m)
  })

  test('every token in the theme is emitted', () => {
    const { theme } = readTheme('[tokens]\nrule-line = "#C8C4B6"\n')
    assert.match(themeCss(theme), /--rule-line: #C8C4B6;/)
    for (const name of TOKEN_NAMES) {
      assert.match(themeCss(theme), new RegExp(`--${name}: `))
    }
  })
})
