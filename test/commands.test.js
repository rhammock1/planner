// @ts-check

/**
 * A command as a manifest declares it, and as `config.toml` holds it.
 *
 * The rendering is a rule rather than a habit (spec §1.6): the pane shows the
 * line, a person approving by hand pastes it, and the two have to be the same
 * string every time or approval by reading is not possible at all.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { renderCommand, placeholdersOf } from '../src/core/commands.js'

test('the reference command renders to the line the spec writes down', () => {
  // Spec §3.2's manifest, rendered to spec §1.6's config line. If this test
  // and the spec ever disagree, one of them is a typo and this is where it
  // shows up. The `=rule` inside each placeholder is this plan's amendment to
  // §1.6: everything outside the braces is the spec's line, byte for byte.
  const rendered = renderCommand([
    'git', '-C', '{repo}', '-c', 'log.showSignature=false', 'log',
    '--since={from} 00:00', '--until={to} 23:59', '--format=%an%x09%s',
  ], [
    { name: 'repo', rule: 'setting', key: 'repo' },
    { name: 'from', rule: 'date', key: '' },
    { name: 'to', rule: 'date', key: '' },
  ])
  assert.equal(
    rendered,
    "git -C {repo=settings.repo} -c log.showSignature=false log " +
    "'--since={from=date} 00:00' '--until={to=date} 23:59' --format=%an%x09%s",
  )
})

test('an argument made only of the safe set is left alone', () => {
  assert.equal(renderCommand(['git', 'log'], []), 'git log')
  assert.equal(renderCommand(['--format=%an%x09%s'], []), '--format=%an%x09%s')
  assert.equal(renderCommand(['/usr/bin/git', 'a,b:c@d%e+f'], []), '/usr/bin/git a,b:c@d%e+f')
})

test('anything else is quoted, because this line is offered to a shell', () => {
  // Not because a shell reads it here - nothing does - but because the pane
  // puts a Copy button beside it. An argument reading `a; rm -rf ~` copied
  // into somebody's terminal has to arrive as one argument, not two commands.
  assert.equal(renderCommand(['a$b;c|d\\e'], []), "'a$b;c|d\\e'")
  assert.equal(renderCommand(['a b'], []), "'a b'")
  assert.equal(renderCommand(['say "no"'], []), `'say "no"'`)
})

test("an inner ' is written the one way a shell would read back", () => {
  assert.equal(renderCommand(["it's"], []), "'it'\\''s'")
})

test('whitespace that is not a space is quoted too', () => {
  // The rule this replaces quoted "a space, a double quote or a `'`". A tab
  // and a non-breaking space are none of those, and both collapse to a single
  // space when the pane draws them - so two different argument lists would
  // have shown a person the same line.
  assert.equal(renderCommand(['a\tb'], []), "'a\tb'")
  assert.equal(renderCommand(['a b'], []), "'a b'")
  assert.notEqual(renderCommand(['a\tb'], []), renderCommand(['a b'], []))
})

test('an empty argument is still an argument', () => {
  // Quoted, so the line shows it. The manifest reader refuses one anyway
  // (below) - but a rendering that dropped an argument silently would be the
  // wrong thing for the reader to be defending against.
  assert.equal(renderCommand(['git', ''], []), "git ''")
})

test('a placeholder nothing binds is rendered as it stands', () => {
  // `readRun` never lets one through, so this is only here to say that
  // rendering is total: it describes an argument list, it does not vet one.
  assert.equal(renderCommand(['{repo}'], []), '{repo}')
})

test('a placeholder is a bare name inside one argument', () => {
  const found = placeholdersOf(['git', '-C', '{repo}', '--since={from} 00:00'])
  assert.deepEqual(found.names, ['repo', 'from'])
  assert.equal(found.error, null)
})

test('a placeholder named twice is named once', () => {
  const found = placeholdersOf(['{a}', '{a}'])
  assert.deepEqual(found.names, ['a'])
})

test('a placeholder that does not close in the argument it opened in is refused', () => {
  // The whole point of an argument list: a placeholder that spanned two
  // arguments would let a bound value decide how many arguments there are.
  const found = placeholdersOf(['--since={from', '00:00}'])
  assert.deepEqual(found.names, [])
  assert.match(found.error ?? '', /does not close/)
})

test('a brace that closes nothing is refused', () => {
  const found = placeholdersOf(['00:00}'])
  assert.match(found.error ?? '', /did not open/)
})

test('a placeholder whose name could not be a config key is refused', () => {
  assert.match(placeholdersOf(['{a.b}']).error ?? '', /cannot bind/)
  assert.match(placeholdersOf(['{}']).error ?? '', /cannot bind/)
})
