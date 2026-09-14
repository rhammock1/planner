// @ts-check
// See the note at the top of `test/sidecar-store.test.js`: this reference is
// program-wide rather than file-scoped, and is accepted for the same reason.
/// <reference types="node" />

/**
 * `boardStore.js` against a stub Tauri host.
 *
 * The thing worth testing here is the one difference from a sidecar: nothing
 * announces these files, so the store has to record its own writes. There is
 * no event to fire by hand - the absence of one is the subject.
 *
 * As in `sidecar-store.test.js`, `ipc/host.js` resolves its host once per
 * process, so the stub goes on `window` before the module is ever imported
 * and every case lives in one test against one store.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

/** @typedef {{command: string, args: any, resolve: (value: unknown) => void, reject: (error: unknown) => void}} Pending */

/**
 * `invoke` never settles on its own, so a test decides exactly when each
 * round trip lands - and can let one fail.
 *
 * @returns {{
 *   tauri: any,
 *   settle: (command: string, value: unknown) => any,
 *   refuse: (command: string, error: unknown) => any,
 *   pending: (command: string) => number,
 * }}
 */
function stubHost() {
  /** @type {Pending[]} */
  const waiting = []

  const tauri = {
    core: {
      invoke: (/** @type {string} */ command, /** @type {any} */ args) =>
        new Promise((resolve, reject) => { waiting.push({ command, args, resolve, reject }) }),
    },
    event: { listen: () => Promise.resolve(() => {}) },
  }

  /** @param {string} command */
  const take = (command) => {
    const at = waiting.findIndex((call) => call.command === command)
    if (at === -1) throw new Error(`no pending ${command} call`)
    const [call] = waiting.splice(at, 1)
    if (call === undefined) throw new Error(`no pending ${command} call`)
    return call
  }

  return {
    tauri,
    settle: (command, value) => {
      const call = take(command)
      call.resolve(value)
      return call.args
    },
    refuse: (command, error) => {
      const call = take(command)
      call.reject(error)
      return call.args
    },
    pending: (command) => waiting.filter((call) => call.command === command).length,
  }
}

/** Lets every settled microtask run before the next assertion. */
function flush() {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

test('a board is read once, written by the app, and never announced back', async () => {
  const stub = stubHost()
  /** @type {any} */
  const untyped = globalThis
  untyped.window = { __TAURI__: stub.tauri }

  /** @type {string[]} */
  const notices = []
  let draws = 0

  // Dynamic, and it has to be: the stub must be on `window` before the module
  // resolves its host. The specifier is a literal, so `tsc` still follows it.
  const { createBoards } = await import('../src/boardStore.js')
  const boards = createBoards({
    onChanged: () => { draws += 1 },
    notice: (line) => { notices.push(line) },
  })

  // Nobody has read it yet, which draws as an empty board and asks.
  assert.equal(boards.text('kanban', 'board'), null)
  await flush()
  assert.equal(stub.pending('read_plugin_file'), 1)

  // A second draw before the read lands does not ask twice - the whole point
  // of holding the read in flight.
  assert.equal(boards.text('kanban', 'board'), null)
  assert.equal(stub.pending('read_plugin_file'), 1)

  const asked = stub.settle('read_plugin_file', '## To do\n- A ^k4m2qa\n')
  assert.deepEqual(asked, { name: 'kanban', file: 'board' })
  await flush()
  assert.equal(boards.text('kanban', 'board'), '## To do\n- A ^k4m2qa\n')
  assert.ok(draws > 0, 'a read that landed did not ask for a redraw')

  // And never asks again: the file is held, and nothing can change it behind
  // this window's back except an editor, which the vault moving would catch.
  assert.equal(stub.pending('read_plugin_file'), 0)

  // A write. The queue holds the new text while the call is in flight, so the
  // tab draws what it just did rather than what the file said before it.
  const writing = boards.change('kanban', 'board', '## To do\n## Doing\n- A ^k4m2qa\n')
  await flush()
  assert.equal(boards.text('kanban', 'board'), '## To do\n## Doing\n- A ^k4m2qa\n')

  const written = stub.settle('write_plugin_file', null)
  assert.deepEqual(written, {
    name: 'kanban',
    file: 'board',
    text: '## To do\n## Doing\n- A ^k4m2qa\n',
  })
  assert.equal(await writing, true)

  // This is the difference from a sidecar. No `board:changed` is coming, so
  // if the store did not record its own write the text would either be lost
  // or be held by the queue for the life of the window. It is neither: the
  // cache now holds it, and no read was made to find that out.
  assert.equal(boards.text('kanban', 'board'), '## To do\n## Doing\n- A ^k4m2qa\n')
  assert.equal(stub.pending('read_plugin_file'), 0)

  // A write that fails says so and leaves the file saying what it said.
  const failing = boards.change('kanban', 'board', 'never lands')
  await flush()
  stub.refuse('write_plugin_file', new Error('read-only vault'))
  assert.equal(await failing, false)
  assert.equal(boards.text('kanban', 'board'), '## To do\n## Doing\n- A ^k4m2qa\n')
  assert.ok(
    notices.some((line) => line.includes('Could not save kanban/board')),
    `nothing was said about the failed write: ${JSON.stringify(notices)}`,
  )

  // A name that cannot be a folder never reaches Rust at all. Checked there
  // too - that is the boundary - but a cache key holding a `/` would be a key
  // two files share.
  assert.equal(boards.text('../elsewhere', 'board'), null)
  assert.equal(boards.text('kanban', '../../someday'), null)
  assert.equal(stub.pending('read_plugin_file'), 0)
  assert.equal(await boards.change('2026', 'board', 'no'), false)
  assert.equal(stub.pending('write_plugin_file'), 0)

  // The vault moved, so what is held is somebody else's board.
  boards.reopen()
  assert.equal(boards.text('kanban', 'board'), null)
  await flush()
  assert.equal(stub.pending('read_plugin_file'), 1)
})
