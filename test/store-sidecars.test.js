// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createWriteQueue } from '../src/writeQueue.js'
import { sidecarRef } from '../src/core/sidecars.js'

test('a queue over plain text writes the newest of two quick edits last', async () => {
  /** @type {string[]} */
  const written = []
  const queue = createWriteQueue(async (key, text) => { written.push(`${key}=${text}`) })
  const key = sidecarRef('2026-09-01', 'meeting-standup')

  const first = queue.change(key, () => '# Standup\n', (was) => `${was}a`)
  const second = queue.change(key, () => '# Standup\n', (was) => `${was}b`)
  await Promise.all([first, second])

  // The second change saw what the first wrote, not what was on disk: two
  // keystrokes inside one round trip must not throw the first away.
  assert.deepEqual(written, [
    `${key}=# Standup\na`,
    `${key}=# Standup\nab`,
  ])
})

test('what has not come back yet is what the next change builds on', async () => {
  const queue = createWriteQueue(async () => {})
  const key = sidecarRef('2026-09-01', 'meeting-standup')

  await queue.change(key, () => 'on disk', () => 'written')
  assert.equal(queue.current(key, () => 'on disk'), 'written')

  // The watcher has now said the file changed, so disk is the only thing
  // worth believing about it again.
  queue.observed(key)
  assert.equal(queue.current(key, () => 'on disk'), 'on disk')
})

test('a null from the mutator writes nothing', async () => {
  /** @type {string[]} */
  const written = []
  const queue = createWriteQueue(async (key) => { written.push(key) })
  assert.equal(await queue.change('sidecar:2026-09-01/meeting', () => null, () => null), false)
  assert.deepEqual(written, [])
})
