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

test('the key steps at the minute, and moves with the generation', () => {
  // The minute, not the quarter hour it used to be. Fifteen minutes is when
  // the alarm thread wakes, which is a fact about the alarm; a slot whose
  // whole subject is the passage of light cannot say anything in four steps
  // an hour that does not read as four jumps.
  assert.equal(tokenKey({ date: '2026-09-02', time: '19:42' }, 3), '2026-09-02:19:42:3')
  assert.equal(tokenKey({ date: '2026-09-02', time: '19:30' }, 3), '2026-09-02:19:30:3')
  assert.equal(tokenKey({ date: '2026-09-02', time: '19:00' }, 3), '2026-09-02:19:00:3')
  assert.equal(tokenKey({ date: '2026-09-02', time: '19:59' }, 3), '2026-09-02:19:59:3')
  // Two minutes running are two different questions, which is the whole
  // point of the change.
  assert.notEqual(
    tokenKey({ date: '2026-09-02', time: '19:42' }, 3),
    tokenKey({ date: '2026-09-02', time: '19:43' }, 3),
  )
  assert.notEqual(
    tokenKey({ date: '2026-09-02', time: '19:42' }, 3),
    tokenKey({ date: '2026-09-02', time: '19:42' }, 4),
  )
  // A time this app did not write is still a key rather than a NaN.
  assert.equal(tokenKey({ date: '2026-09-02', time: '' }, 1), '2026-09-02:00:00:1')
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

test('a value longer than a sky has any business being is dropped, not cut', () => {
  // Dropped rather than truncated, unlike a contributed line or a heading: a
  // colour cut in half is not a shorter colour, it is a broken declaration.
  const read = readPluginTokens([{ plugin: 'dusk', value: { paper: 'x'.repeat(500) } }], DUSK)
  assert.equal(read.tokens.has('paper'), false)
  assert.equal(read.notices.length, 1)
})

test('a sky is longer than a colour, and fits', () => {
  // Three gradient layers over a theme's own texture. 200 characters was a
  // guess about how long a colour is; what defends this value is the bracket
  // and character checks, and none of those get weaker with length.
  const sky =
    'radial-gradient(64% 46% at 105% 24%, #9a3a5775, transparent 66%), ' +
    'radial-gradient(90% 34% at -5% 2%, #a87e9840, transparent 70%), ' +
    'linear-gradient(180deg, #3f4a8380, #9a3a5738 74%), ' +
    'repeating-linear-gradient(180deg, transparent 0 27px, #C4D0DE 27px 28px)'
  assert.ok(sky.length > 200, 'the fixture stopped being the awkward case')

  const moves = new Map([['dusk', ['texture']]])
  const read = readPluginTokens([{ plugin: 'dusk', value: { texture: sky } }], moves)
  assert.equal(read.tokens.get('texture'), sky)
  assert.deepEqual(read.notices, [])
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

test('a value that would swallow the rule takes nothing else with it', () => {
  // The reason `forbidden` checks that brackets close. Tokens are written out
  // in name order, so `accent` lands first: unrefused, it would open a
  // function the browser consumes to the end of the sheet and `two` would
  // lose colours it was granted, silently, because the app believes it wrote
  // them.
  const moves = new Map([['one', ['accent']], ['two', ['paper', 'ink']]])
  const { tokens, notices } = readPluginTokens([
    { plugin: 'one', value: { accent: 'rgb(' } },
    { plugin: 'two', value: { paper: '#F6EEDD', ink: '#2A2622' } },
  ], moves)

  assert.equal(tokens.has('accent'), false)
  assert.equal(tokens.get('paper'), '#F6EEDD')
  assert.equal(tokens.get('ink'), '#2A2622')
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /^one's accent was refused/)
})

test('a plugin with nothing to say is not a plugin misbehaving', () => {
  // A handler that falls off the end answers `null`, and that is an answer.
  // Reported as a shape error it would send an author looking for a bug in
  // the one code path where they wrote no bug.
  const { tokens, notices } = readPluginTokens(
    [{ plugin: 'dusk', value: null }],
    new Map([['dusk', ['paper']]]),
  )
  assert.equal(tokens.size, 0)
  assert.deepEqual(notices, [])
})

test('a plugin answering with thirteen bad values still gets one line', () => {
  // Spec §6: counted, not listed. The first is named because the token's own
  // name is the useful half of the sentence.
  const moves = new Map([['one', ['paper', 'ink', 'dim', 'surface']]])
  const { notices } = readPluginTokens([{
    plugin: 'one',
    value: { paper: 'a;b', ink: 'c{d', dim: 'rgb(', surface: 'e}f' },
  }], moves)

  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /and 3 more/)
})
