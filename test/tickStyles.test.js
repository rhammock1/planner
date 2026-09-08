// @ts-check

/**
 * Every kind of tick the plugin pane draws has a rule to draw it with.
 *
 * A tick's kind becomes its class name and nothing else joins the two
 * (`views/tick.js`), so a kind added without a stylesheet rule does not fail -
 * it renders as a bare `<label>`, which in a pane of 11px monospace rows means
 * one at the body size, inline with the next instead of on its own line, and
 * running off the right-hand edge. `theme.tokens` shipped exactly that way:
 * seven `Moves <colour>` rows across two lines of overflowing text.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { TICK_KINDS } from '../src/views/tickKinds.js'

const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8')

/**
 * Every class name the stylesheet gives a rule to.
 *
 * Read out of the selectors rather than searched for as text, so a kind named
 * only inside a comment - which is where a removed rule tends to leave its
 * name - does not count as styled.
 *
 * @type {Set<string>}
 */
const styled = new Set()
for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').split('{')) {
  // What precedes a `{` and follows the previous block's `}` is a selector.
  const selector = block.slice(block.lastIndexOf('}') + 1)
  for (const found of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) {
    const name = found[1]
    if (name !== undefined) styled.add(name)
  }
}

for (const kind of TICK_KINDS) {
  test(`a ${kind} tick has a rule to draw it with`, () => {
    assert.ok(
      styled.has(kind),
      `components.css has no .${kind} rule, so that row draws at the body size and inline`,
    )
  })
}

test('the check can tell a missing rule from a present one', () => {
  // Otherwise a selector scan that quietly matched nothing would pass every
  // assertion above by finding every class in the file.
  assert.ok(!styled.has('slot-there-is-no-rule-for'))
  assert.ok(styled.has('plugin-problem'))
})
