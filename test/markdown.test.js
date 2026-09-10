import { test } from 'node:test'
import assert from 'node:assert/strict'

import { blockOf, inlineOf, linkTarget } from '../src/core/markdown.js'

test('a block is its marker and the rest, and the two rebuild the line', () => {
  for (const line of [
    '# Heading', '## Smaller', '### Smaller still',
    '- A bullet', '* Also a bullet', '1. A number', '12. A bigger number',
    '> A quote', 'Just a line', '', '   ',
  ]) {
    const block = blockOf(line)
    assert.equal(block.marker + block.text, line, `rebuilds ${JSON.stringify(line)}`)
  }
})

test('each kind is spelled by its own marker', () => {
  assert.deepEqual(blockOf('# Title'), { kind: 'h1', marker: '# ', text: 'Title' })
  assert.deepEqual(blockOf('## Title'), { kind: 'h2', marker: '## ', text: 'Title' })
  assert.deepEqual(blockOf('### Title'), { kind: 'h3', marker: '### ', text: 'Title' })
  assert.deepEqual(blockOf('- One'), { kind: 'li', marker: '- ', text: 'One' })
  assert.deepEqual(blockOf('1. One'), { kind: 'ol', marker: '1. ', text: 'One' })
  assert.deepEqual(blockOf('> Said'), { kind: 'quote', marker: '> ', text: 'Said' })
  assert.deepEqual(blockOf('Plain'), { kind: 'p', marker: '', text: 'Plain' })
  assert.deepEqual(blockOf(''), { kind: 'blank', marker: '', text: '' })
})

test("a marker needs its space, or it is not a marker", () => {
  assert.equal(blockOf('#Title').kind, 'p')
  assert.equal(blockOf('#### Four').kind, 'p', 'the subset stops at three')
  assert.equal(blockOf('-Dash').kind, 'p')
  assert.equal(blockOf('1.No space').kind, 'p')
})

test('an ordered marker is as long as its number', () => {
  assert.equal(blockOf('7. Seven').marker, '7. ')
  assert.equal(blockOf('117. A hundred').marker, '117. ')
})

test('the leftmost inline rule wins, so bold is not two emphases', () => {
  assert.deepEqual(inlineOf('**bold**'), [
    { kind: 'strong', children: [{ kind: 'text', text: 'bold' }] },
  ])
  assert.deepEqual(inlineOf('*just italic*'), [
    { kind: 'em', children: [{ kind: 'text', text: 'just italic' }] },
  ])
})

test('inline spans keep the text around them', () => {
  assert.deepEqual(inlineOf('a `code` b'), [
    { kind: 'text', text: 'a ' },
    { kind: 'code', text: 'code' },
    { kind: 'text', text: ' b' },
  ])
})

test('a code span is not looked inside', () => {
  assert.deepEqual(inlineOf('`**not bold**`'), [
    { kind: 'code', text: '**not bold**' },
  ])
})

test('strikethrough, and nesting inside emphasis', () => {
  assert.deepEqual(inlineOf('~~gone~~'), [
    { kind: 'del', children: [{ kind: 'text', text: 'gone' }] },
  ])
  assert.deepEqual(inlineOf('**bold `code`**'), [
    {
      kind: 'strong',
      children: [{ kind: 'text', text: 'bold ' }, { kind: 'code', text: 'code' }],
    },
  ])
})

test('emphasis nests both ways round', () => {
  assert.deepEqual(inlineOf('*a **b** c*'), [
    {
      kind: 'em',
      children: [
        { kind: 'text', text: 'a ' },
        { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
        { kind: 'text', text: ' c' },
      ],
    },
  ])
  assert.deepEqual(inlineOf('**a *b* c**'), [
    {
      kind: 'strong',
      children: [
        { kind: 'text', text: 'a ' },
        { kind: 'em', children: [{ kind: 'text', text: 'b' }] },
        { kind: 'text', text: ' c' },
      ],
    },
  ])
})

test('a delimiter hugs its text, so arithmetic is not emphasis', () => {
  assert.deepEqual(inlineOf('5 * 3 = 15 and 2 * 4 = 8'), [
    { kind: 'text', text: '5 * 3 = 15 and 2 * 4 = 8' },
  ])
  assert.deepEqual(inlineOf('**unclosed'), [{ kind: 'text', text: '**unclosed' }])
})

test('a url may hold one level of balanced parentheses', () => {
  assert.deepEqual(inlineOf('[a](https://x.test/a(b))'), [
    { kind: 'link', text: 'a', url: 'https://x.test/a(b)', where: 'out' },
  ])
})

test('a line of unterminated links does not hang the parser', () => {
  // The shape that used to explore both url branches on every `(`: 5000
  // openers, no closing paren anywhere - 20 KB, the size a reviewer clocked
  // at about 98 seconds on the old regex, on the main thread, from merely
  // opening the note. What that bug breaks is a hang, not a wrong answer, and
  // a hang leaves no wrong output behind for `deepEqual` to catch - the only
  // assertion that sees it is one about time. The suite runs with no
  // `--test-timeout`, on purpose (see package.json), so a regression here
  // must fail on its own rather than hang the runner forever; a threshold
  // has to be picked with that in mind. One second is orders of magnitude
  // above the fixed parser's real cost - tens of microseconds at this size -
  // so this doesn't flake under load, and orders of magnitude below the old
  // regex's, so a return of the bug fails loudly instead of quietly passing
  // like it did at 500 openers.
  const pathological = '[a]('.repeat(5000)
  const start = performance.now()
  const result = inlineOf(pathological)
  const elapsed = performance.now() - start
  assert.ok(elapsed < 1000, `parsing took ${elapsed}ms, expected under 1000ms`)
  assert.deepEqual(result, [{ kind: 'text', text: pathological }])
})

test('a link carries where it may go', () => {
  assert.deepEqual(inlineOf('[a](https://example.com/x)'), [
    { kind: 'link', text: 'a', url: 'https://example.com/x', where: 'out' },
  ])
  assert.deepEqual(inlineOf('[b](sidecar:2026-09-08/meeting-standup)'), [
    { kind: 'link', text: 'b', url: 'sidecar:2026-09-08/meeting-standup', where: 'in' },
  ])
  assert.deepEqual(inlineOf('[c](javascript:whatever)'), [
    { kind: 'link', text: 'c', url: 'javascript:whatever', where: 'dead' },
  ])
})

test('only three schemes leave the app, and a ref must be a whole ref', () => {
  assert.equal(linkTarget('https://x.test/a'), 'out')
  assert.equal(linkTarget('http://x.test/a'), 'out')
  assert.equal(linkTarget('mailto:a@x.test'), 'out')
  assert.equal(linkTarget('sidecar:2026-09-08/meeting-standup'), 'in')
  assert.equal(linkTarget('javascript:alert'), 'dead')
  assert.equal(linkTarget('file:///etc/passwd'), 'dead')
  assert.equal(linkTarget('sidecar:2026-09-08'), 'dead', 'no suffix')
  assert.equal(linkTarget('sidecar:not-a-date/x'), 'dead')
  assert.equal(linkTarget('sidecar:2026-09-08/Not-A-Suffix'), 'dead')
  assert.equal(linkTarget(''), 'dead')
})

test('text with no markup is one run', () => {
  assert.deepEqual(inlineOf('nothing here'), [{ kind: 'text', text: 'nothing here' }])
  assert.deepEqual(inlineOf(''), [])
})
