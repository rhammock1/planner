// @ts-check
// This reference is program-wide, not file-scoped - see the same note in
// `test/sidecar-store.test.js`.
/// <reference types="node" />

/**
 * `fileStore.js` against a stub Tauri host, so `file:changed` can be fired by
 * hand rather than by an actual write landing on disk.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * A call the stub host has not answered yet.
 * @typedef {{command: string, resolve: (value: unknown) => void, reject: (error: unknown) => void}} Pending
 */

/**
 * @returns {{
 *   tauri: any,
 *   fireChanged: (path: string) => void,
 *   resolveNext: (command: string, value: unknown) => void,
 *   rejectNext: (command: string, error: unknown) => void,
 *   pendingCount: (command: string) => number,
 * }}
 */
function stubHost() {
  /** @type {Pending[]} */
  const pending = []
  /** @type {((event: {payload: unknown}) => void)|null} */
  let onChanged = null

  const tauri = {
    core: {
      invoke: (/** @type {string} */ command) =>
        new Promise((resolve, reject) => { pending.push({ command, resolve, reject }) }),
    },
    event: {
      listen: (/** @type {string} */ name, /** @type {(event: {payload: unknown}) => void} */ handler) => {
        if (name === 'file:changed') onChanged = handler
        return Promise.resolve(() => {})
      },
    },
  }

  /** @param {string} command @returns {Pending} */
  const take = (command) => {
    const at = pending.findIndex((call) => call.command === command)
    if (at === -1) throw new Error(`no pending ${command} call`)
    const [call] = pending.splice(at, 1)
    if (call === undefined) throw new Error(`no pending ${command} call`)
    return call
  }

  return {
    tauri,
    fireChanged: (path) => {
      if (onChanged === null) throw new Error('nothing subscribed to file:changed')
      onChanged({ payload: { path } })
    },
    resolveNext: (command, value) => { take(command).resolve(value) },
    rejectNext: (command, error) => { take(command).reject(error) },
    pendingCount: (command) => pending.filter((call) => call.command === command).length,
  }
}

/** Lets every settled microtask run before the next assertion. */
function flush() {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

test('the one file the window holds', async () => {
  const stub = stubHost()

  // Cast because `window` is read-only under the DOM lib and this test
  // replaces it wholesale.
  /** @type {any} */
  const untyped = globalThis
  untyped.window = { __TAURI__: stub.tauri }

  // A dynamic import, and it has to be: the stub above must be on `window`
  // before `fileStore.js` is loaded, and a static import is hoisted above the
  // line that puts it there.
  const { createFiles } = await import('../src/fileStore.js')

  /** @type {string[]} */
  const notices = []
  let drawn = 0
  const files = createFiles({
    onChanged: () => { drawn += 1 },
    notice: (line) => { notices.push(line) },
  })
  await files.start()

  // A file that is not on disk yet opens empty and says so. `null` from
  // `read_file` is the only thing that tells a new file from an empty one,
  // and `exists` is what the footer draws `New file` from.
  const opening = files.open('/Users/x/Planner/new.md')
  await flush()
  stub.resolveNext('read_file', null)
  await opening
  assert.deepEqual(files.showing(), { path: '/Users/x/Planner/new.md', text: '', exists: false })

  // A second file replaces the first: this window shows one at a time.
  const second = files.open('/Users/x/Planner/campaign.md')
  await flush()
  stub.resolveNext('read_file', '# A Rumbling of Thunder\n')
  await second
  assert.deepEqual(files.showing(), {
    path: '/Users/x/Planner/campaign.md',
    text: '# A Rumbling of Thunder\n',
    exists: true,
  })

  // The hazard `writeQueue.js` exists for, over a path rather than a page:
  // what has been written but has not come back from disk yet is what the
  // view must be shown, or the next keystroke builds on the old text.
  const writing = files.change('/Users/x/Planner/campaign.md', '# Session 1\n')
  await flush()
  assert.equal(files.showing()?.text, '# Session 1\n')
  stub.resolveNext('write_file', undefined)
  assert.equal(await writing, true)
  assert.equal(files.showing()?.exists, true, 'a written file is no longer new')

  // A change to a file this window is not showing is not this window's. The
  // registry in Rust names one file and so does this, and reading it would be
  // a round trip for a file nobody is looking at.
  stub.fireChanged('/Users/x/Planner/somebody-else.md')
  await flush()
  assert.equal(stub.pendingCount('read_file'), 0)

  // An edit arriving from disk is taken, and a draw is asked for. This is
  // nvim, from here indistinguishable from the app's own write.
  const before = drawn
  stub.fireChanged('/Users/x/Planner/campaign.md')
  await flush()
  assert.equal(stub.pendingCount('read_file'), 1)
  stub.resolveNext('read_file', '# From nvim\n')
  await flush()
  assert.equal(files.showing()?.text, '# From nvim\n')
  assert.ok(drawn > before, 'an arriving edit has to ask for a draw or nothing shows it')

  // A refused write says so and leaves the file holding what disk holds.
  // Returning false is what lets the view keep the text rather than pretend
  // the write landed.
  const refused = files.change('/Users/x/Planner/campaign.md', '# Session 2\n')
  await flush()
  stub.rejectNext('write_file', new Error('read-only'))
  assert.equal(await refused, false)
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /Could not save/u)
  assert.equal(files.showing()?.text, '# From nvim\n', 'a failed write must not be believed')

  // Closing lets go of it: nothing to draw, and nothing to write.
  files.close()
  assert.equal(files.showing(), null)
})
