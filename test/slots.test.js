// @ts-check

/**
 * Which slots exist, and what the pane says about each one.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { SLOTS, isSlot, sentenceFor, optionsTableOf } from '../src/core/slots.js'

test('the slots that exist are the ones with a consumer', () => {
  // A slot with no consumer is a guess about an API (spec §0). Adding a name
  // here without the plugin that needs it is the mistake this test catches.
  assert.deepEqual(SLOTS.map((slot) => slot.name), ['vault.contribute', 'item.badge', 'theme.tokens', 'page.section'])
})

test('every slot has a sentence a person could tick', () => {
  for (const slot of SLOTS) {
    assert.ok(slot.sentence.length > 0, `${slot.name} has no sentence`)
    assert.ok(slot.sentence.endsWith('.'), `${slot.name}'s sentence is not a sentence`)
  }
})

test('a slot this app does not offer is not a slot', () => {
  assert.equal(isSlot('vault.contribute'), true)
  assert.equal(isSlot('item.badge'), true)
  assert.equal(isSlot('theme.tokens'), true)
  assert.equal(isSlot('page.section'), true)
  // A slot no version of this app has offered, so this test still has a name
  // that is not one.
  assert.equal(isSlot('page.footer'), false)
  assert.equal(isSlot(''), false)
})

test('an unknown slot still gets a sentence, because the pane has to draw it', () => {
  const said = sentenceFor('vault.write')
  assert.match(said, /vault\.write/)
  assert.match(said, /does not offer/)
})

test('a slot names the table its options live in, or names none', () => {
  // One convention, not eight keys in five shapes (spec §1.1): the table is
  // named for the slot's last word, and only a slot that needs to be told
  // something the question does not carry has one.
  assert.equal(optionsTableOf('vault.contribute'), 'contribute')
  assert.equal(optionsTableOf('item.badge'), null)
  assert.equal(optionsTableOf('theme.tokens'), 'tokens')
})

test('page.section is offered, with a sentence about what it is shown', () => {
  assert.equal(isSlot('page.section'), true)
  assert.equal(optionsTableOf('page.section'), null, 'it needs nothing the question does not carry')
  assert.match(sentenceFor('page.section'), /beside the day/)
})
