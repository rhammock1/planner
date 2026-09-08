// @ts-check

/**
 * What a plugin may do to the theme's colours, and what it may not.
 *
 * Everything here arrived from somebody else's code and lands inside a CSS
 * rule this app writes, so the same checks a theme's own values get apply -
 * and two of them on top: a plugin may only move what its manifest said it
 * would move, and no two plugins may move the same thing.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { tokenKey, readPluginTokens, pluginTokensCss } from '../src/core/tokens.js'

const DUSK = new Map([['dusk', ['paper', 'ink']]])

test('the key steps at the quarter hour, and moves with the generation', () => {
  // Every fifteen minutes is the resolution the clock-driven slots get: the
  // alarm thread wakes then, so a finer key would ask questions nothing
  // would answer differently (spec §1.4).
  assert.equal(tokenKey({ date: '2026-09-02', time: '19:42' }, 3), '2026-09-02:19:30:3')
  assert.equal(tokenKey({ date: '2026-09-02', time: '19:30' }, 3), '2026-09-02:19:30:3')
  assert.equal(tokenKey({ date: '2026-09-02', time: '19:00' }, 3), '2026-09-02:19:00:3')
  assert.equal(tokenKey({ date: '2026-09-02', time: '19:59' }, 3), '2026-09-02:19:45:3')
  assert.notEqual(
    tokenKey({ date: '2026-09-02', time: '19:42' }, 3),
    tokenKey({ date: '2026-09-02', time: '19:42' }, 4),
  )
})

test('a token a plugin said it would move is moved', () => {
  const read = readPluginTokens([{ plugin: 'dusk', value: { paper: '#F6EEDD', ink: '#2A2622' } }], DUSK)
  assert.deepEqual([...read.tokens], [['ink', '#2A2622'], ['paper', '#F6EEDD']])
  assert.deepEqual(read.notices, [])
})

test('a token it did not say it would move is dropped and counted', () => {
  const read = readPluginTokens([{ plugin: 'dusk', value: { paper: '#F6EEDD', accent: '#000000' } }], DUSK)
  assert.deepEqual([...read.tokens.keys()], ['paper'])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /dusk/)
})

test('a name no theme has is not a token', () => {
  const moves = new Map([['dusk', ['paper', 'invented']]])
  const read = readPluginTokens([{ plugin: 'dusk', value: { invented: 'red' } }], moves)
  assert.equal(read.tokens.size, 0)
  assert.equal(read.notices.length, 1)
})

test('a value that would leave the rule it sits in is refused, with the reason', () => {
  for (const value of [
    'red; position: fixed', 'red}', '@import url(x)', 'url(https://evil/x)',
    'a\\b', '<b>', 'image-set("https://evil/x" 1x)', 'red /*',
  ]) {
    const read = readPluginTokens([{ plugin: 'dusk', value: { paper: value } }], DUSK)
    assert.equal(read.tokens.size, 0, `${value} was let through`)
    assert.equal(read.notices.length, 1)
  }
})

test('a value that is not a string is not a value', () => {
  const read = readPluginTokens([{ plugin: 'dusk', value: { paper: 4 } }], DUSK)
  assert.equal(read.tokens.size, 0)
})

test('a value longer than a colour has any business being is dropped, not cut', () => {
  // Dropped rather than truncated, unlike a contributed line or a heading: a
  // colour cut in half is not a shorter colour, it is a broken declaration.
  const read = readPluginTokens([{ plugin: 'dusk', value: { paper: 'x'.repeat(300) } }], DUSK)
  assert.equal(read.tokens.has('paper'), false)
  assert.equal(read.notices.length, 1)
})

test('a value is flattened to one line', () => {
  // Asserted on what comes out rather than on what does not: a test that only
  // checked for the absence of a newline would pass against a reader that
  // dropped every value it was ever given.
  const read = readPluginTokens(
    [{ plugin: 'dusk', value: { paper: 'linear-gradient(\n  #fff, #000)' } }],
    DUSK,
  )
  assert.equal(read.tokens.get('paper'), 'linear-gradient( #fff, #000)')
})

test('a plugin that did not answer with a map is named', () => {
  const read = readPluginTokens([{ plugin: 'dusk', value: ['#F6EEDD'] }], DUSK)
  assert.equal(read.tokens.size, 0)
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /dusk/)
})

test('two plugins moving the same colour: the second by name does not', () => {
  // Colour is not a thing two plugins can each have half of. In name order,
  // so which of them wins is the same on every launch.
  const moves = new Map([['dusk', ['paper']], ['amber', ['paper', 'ink']]])
  const read = readPluginTokens(
    [{ plugin: 'amber', value: { paper: '#111111', ink: '#222222' } },
     { plugin: 'dusk', value: { paper: '#F6EEDD' } }],
    moves,
  )
  assert.deepEqual([...read.tokens], [['ink', '#222222'], ['paper', '#111111']])
  const said = read.notices.join(' ')
  assert.match(said, /amber/)
  assert.match(said, /dusk/)
  assert.match(said, /paper/)
})

test('the refusal is decided by what was declared, not by who answered first', () => {
  // The claim is on `moves`, so a plugin that answers nothing still holds the
  // token it declared - otherwise the page would change colour depending on
  // which plugin happened to be slow.
  const moves = new Map([['amber', ['paper']], ['dusk', ['paper']]])
  const read = readPluginTokens([{ plugin: 'dusk', value: { paper: '#F6EEDD' } }], moves)
  assert.equal(read.tokens.size, 0)
})

test('nothing to move is no rule at all, not an empty one', () => {
  assert.equal(pluginTokensCss(new Map()), '')
})

test('what is moved becomes one rule, in a settled order', () => {
  assert.equal(
    pluginTokensCss(new Map([['paper', '#F6EEDD'], ['ink', '#2A2622']])),
    ':root {\n  --ink: #2A2622;\n  --paper: #F6EEDD;\n}\n',
  )
})
