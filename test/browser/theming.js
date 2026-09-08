// @ts-check

/**
 * Where a plugin's colours sit in the cascade.
 *
 * Only a browser can answer this: the question is which of three rules wins,
 * and that is the cascade's own arithmetic rather than anything this app
 * computes.
 */

import { check, equal, report } from './harness.js'
import { styleElement } from '../../src/ui/dom.js'
import { themeCss } from '../../src/core/theme.js'
import { pluginTokensCss } from '../../src/core/tokens.js'

check('the sheets cascade in order however they are asked for', () => {
  // The order used to be a fact about which file ran first, and this file
  // establishing it by hand was the reason the test could not fail: it built
  // the arrangement it was checking. So the plugin's sheet is asked for
  // *first* here, which is the arrangement nothing in the app produces and
  // exactly the one a future reordering would.
  styleElement('theme-plugin')
  styleElement('theme-css')
  styleElement('theme-tokens')

  const ids = [...document.head.querySelectorAll('style[id]')].map((one) => one.id)
  equal(
    ids.join(' '),
    'theme-tokens theme-css theme-plugin',
    'the sheets are not in cascade order',
  )
})

check('a plugin wins over the theme, and over the theme stylesheet', () => {
  styleElement('theme-tokens').textContent = themeCss({
    name: 'Ledger', author: 'x', appearance: 'light',
    tokens: new Map([['paper', '#FBFAF6']]),
  })
  styleElement('theme-css').textContent = ':root { --paper: #FF0000; }'
  styleElement('theme-plugin').textContent = pluginTokensCss(new Map([['paper', '#F6EEDD']]))

  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()
  equal(paper, '#F6EEDD', 'a plugin could not move a colour a theme.css had set')
})

check('a plugin that moved nothing leaves the theme alone', () => {
  styleElement('theme-plugin').textContent = pluginTokensCss(new Map())
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()
  equal(paper, '#FF0000', 'an empty rule changed the page')
})

report()
