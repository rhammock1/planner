// @ts-check

/**
 * What a plugin may open, and the comparison that decides it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readPrefix, mayOpen, resolvePrefix } from '../src/core/urls.js'

test('a prefix is an http URL ending in a slash', () => {
  assert.equal(readPrefix('https://github.com/gotab-inc/node/pull/').error, null)
  assert.equal(readPrefix('http://localhost:8080/tickets/').error, null)
})

test('a prefix that is not a URL at all is refused', () => {
  assert.match(readPrefix('not a url').error ?? '', /not a URL/)
})

test('a prefix that is not http is refused', () => {
  for (const bad of ['file:///etc/', 'javascript:alert(1)', 'plugin://x/', 'data:text/html,x']) {
    assert.match(readPrefix(bad).error ?? '', /https/, bad)
  }
})

test('a prefix carrying a username is refused', () => {
  assert.match(readPrefix('https://user@github.com/x/').error ?? '', /user/)
  assert.match(readPrefix('https://user:pw@github.com/x/').error ?? '', /user/)
})

test('a prefix carrying a query or a fragment is refused', () => {
  // The pane shows the entry verbatim on its checkbox, and the comparison
  // reads scheme, host, port and path segments only. So this one reads to a
  // person as "the pull requests of gotab-inc/node" and would in fact approve
  // every address on github.com. Refused, rather than shown narrower than it
  // is, so the label and the enforced scope are the same string.
  assert.match(readPrefix('https://github.com/?a=/gotab-inc/node/pull/').error ?? '', /query|fragment/)
  assert.match(readPrefix('https://github.com/#/gotab-inc/node/pull/').error ?? '', /query|fragment/)
  assert.match(readPrefix('https://github.com/x/?').error ?? '', /query|fragment/)
})

test('a query-carrying prefix approves nothing, not everything on the host', () => {
  const wide = readPrefix('https://github.com/?a=/gotab-inc/node/pull/')
  assert.equal(mayOpen('https://github.com/settings/tokens', [wide.prefix]), false)
})

test('a prefix that does not end in a slash is refused', () => {
  // Without it, `https://github.com/gotab` would approve
  // `https://github.com/gotabbing-elsewhere`.
  assert.match(readPrefix('https://github.com/gotab-inc/node').error ?? '', /slash/)
})

const PREFIXES = ['https://github.com/gotab-inc/node/pull/']

test('a URL under the prefix may be opened', () => {
  assert.equal(mayOpen('https://github.com/gotab-inc/node/pull/4412', PREFIXES), true)
  assert.equal(mayOpen('https://github.com/gotab-inc/node/pull/4412?tab=files#c1', PREFIXES), true)
})

test('a look-alike host may not', () => {
  // The one a string comparison waves through.
  assert.equal(mayOpen('https://github.com.evil.io/gotab-inc/node/pull/1', PREFIXES), false)
  assert.equal(mayOpen('https://notgithub.com/gotab-inc/node/pull/1', PREFIXES), false)
})

test('climbing out of the prefix may not', () => {
  assert.equal(mayOpen('https://github.com/gotab-inc/node/pull/../../evil/1', PREFIXES), false)
  assert.equal(mayOpen('https://github.com/gotab-inc/node/pull/%2e%2e/evil', PREFIXES), false)
})

test('a sibling path that merely starts with the same letters may not', () => {
  assert.equal(mayOpen('https://github.com/gotab-inc/nodex/pull/1', PREFIXES), false)
})

test('a different scheme, port or userinfo may not', () => {
  assert.equal(mayOpen('http://github.com/gotab-inc/node/pull/1', PREFIXES), false)
  assert.equal(mayOpen('https://github.com:8443/gotab-inc/node/pull/1', PREFIXES), false)
  assert.equal(mayOpen('https://evil@github.com/gotab-inc/node/pull/1', PREFIXES), false)
})

test('the prefix itself may be opened', () => {
  assert.equal(mayOpen('https://github.com/gotab-inc/node/pull/', PREFIXES), true)
})

test('with no prefixes, nothing opens', () => {
  assert.equal(mayOpen('https://github.com/gotab-inc/node/pull/1', []), false)
})

test('a href that is not a URL opens nothing', () => {
  assert.equal(mayOpen('javascript:alert(1)', PREFIXES), false)
  assert.equal(mayOpen('', PREFIXES), false)
})

test('a literal entry resolves to itself', () => {
  const held = new Map()
  assert.equal(resolvePrefix('https://x.example/t/', held).prefix, 'https://x.example/t/')
})

test('an entry naming a setting resolves to what the person typed', () => {
  const held = new Map([['url', 'https://git.example/org/repo/pull/$1']])
  // Cut at its first `$`: the setting is a template, and everything from the
  // first placeholder on is the part that varies.
  assert.equal(
    resolvePrefix('settings.url', held).prefix,
    'https://git.example/org/repo/pull/',
  )
})

test('an unset setting is no prefix at all, and opens nothing', () => {
  const { prefix, error } = resolvePrefix('settings.url', new Map())
  assert.equal(prefix, '')
  assert.match(error ?? '', /not been set/)
})

test('a setting whose value is not an address is refused like any other', () => {
  const held = new Map([['url', 'file:///etc/$1']])
  assert.match(resolvePrefix('settings.url', held).error ?? '', /https/)
})

test('a setting whose value has no placeholder is used whole', () => {
  const held = new Map([['url', 'https://x.example/t/']])
  assert.equal(resolvePrefix('settings.url', held).prefix, 'https://x.example/t/')
})
