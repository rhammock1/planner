// @ts-check
// This reference is program-wide, not file-scoped: once any file included
// under `tsconfig.web.json` pulls in `@types/node`, its ambient globals
// (`process`, `Buffer`, `require`, and the rest) resolve for every file in
// that program, not just this one - TypeScript has no way to bring in
// `@types/node`'s `node:test` and `node:assert/strict` module declarations
// without its global ones too. Accepted anyway: the alternative, adding
// `"node"` to that program's `"types"`, leaks the same globals but
// permanently, where this leaves with the file that needs it.
/// <reference types="node" />

/**
 * `sidecarStore.js` against a stub Tauri host, so `sidecar:changed` can be
 * fired by hand rather than by an actual write landing on disk.
 *
 * `ipc.js` resolves its host from `window.__TAURI__` (see `ipc/host.js`) and
 * caches that resolution for the life of the process, so the stub has to be
 * in place before `createSidecars(...).start()` first asks for one - which is
 * why `window` is set at the top of this file rather than per test. Node's
 * test runner gives each `*.test.js` file its own process, so this does not
 * leak into any other file.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * A call the stub host has not answered yet.
 * @typedef {{command: string, resolve: (value: unknown) => void}} Pending
 */

/**
 * Builds a fake `window.__TAURI__`: `invoke` never resolves on its own, so a
 * test controls exactly when each round trip lands, and `event.listen`
 * remembers the `sidecar:changed` handler so a test can fire one by hand.
 *
 * @returns {{
 *   tauri: any,
 *   fireChanged: (date: string, suffix: string) => void,
 *   resolveNext: (command: string, value: unknown) => void,
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
        new Promise((resolve) => { pending.push({ command, resolve }) }),
    },
    event: {
      listen: (/** @type {string} */ name, /** @type {(event: {payload: unknown}) => void} */ handler) => {
        if (name === 'sidecar:changed') onChanged = handler
        return Promise.resolve(() => {})
      },
    },
  }

  return {
    tauri,
    fireChanged: (date, suffix) => {
      if (onChanged === null) throw new Error('nothing subscribed to sidecar:changed')
      onChanged({ payload: { date, suffix } })
    },
    resolveNext: (command, value) => {
      const at = pending.findIndex((call) => call.command === command)
      if (at === -1) throw new Error(`no pending ${command} call`)
      const [call] = pending.splice(at, 1)
      call?.resolve(value)
    },
    pendingCount: (command) => pending.filter((call) => call.command === command).length,
  }
}

/** Lets every settled microtask run before the next assertion. */
function flush() {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

test('a sidecar:changed for a day keeps serving its last listing while it refreshes', async () => {
  const stub = stubHost()

  // Cast because `window` is read-only under the DOM lib and this test
  // replaces it wholesale. Only the assignment is unchecked; the module below
  // is imported by a literal specifier and is fully typed.
  /** @type {any} */
  const untyped = globalThis
  untyped.window = { __TAURI__: stub.tauri }

  // A dynamic import, and it has to be: the stub above must be on `window`
  // before `sidecarStore.js` is loaded, and a static import is hoisted above
  // the line that puts it there. The specifier is a literal, though, so `tsc`
  // follows it and a renamed export is a compile error - this file is checked
  // under `tsconfig.web.json`, which has the DOM lib the module needs.
  const { createSidecars } = await import('../src/sidecarStore.js')
  const sidecars = createSidecars({ onChanged: () => {}, notice: () => {} })
  await sidecars.start()

  // First ask: nobody has listed this day yet, so this is the one place `[]`
  // is the right answer.
  assert.deepEqual(sidecars.on('2026-09-01'), [])
  await flush()
  stub.resolveNext('list_sidecars', [{ date: '2026-09-01', suffix: 'meeting-standup', title: 'Standup' }])
  await flush()
  assert.deepEqual(sidecars.on('2026-09-01'), [{ suffix: 'meeting-standup', title: 'Standup' }])

  // The app's own write of that block lands, exactly as vault.rs's
  // write_sidecar announces it - indistinguishable, from here, from nvim
  // touching the file. `readSidecar` is awaited before the day is refreshed.
  stub.fireChanged('2026-09-01', 'meeting-standup')
  await flush()
  stub.resolveNext('read_sidecar', '# Standup\n\nNotes')
  await flush()

  // The refresh this triggers is now in flight - `list_sidecars` has been
  // asked again and has not answered. This is the bug: the old code deleted
  // the cache right here, so `on` would answer `[]` and the block would tear
  // itself down mid-edit. It must still answer the last known listing.
  assert.equal(stub.pendingCount('list_sidecars'), 1)
  assert.deepEqual(
    sidecars.on('2026-09-01'),
    [{ suffix: 'meeting-standup', title: 'Standup' }],
    'answered [] while a refresh was in flight - the block would have torn itself down',
  )

  // Once the refresh lands, its answer is what is served - a note created
  // moments ago is not lost by the fix that keeps the old one on screen.
  stub.resolveNext('list_sidecars', [
    { date: '2026-09-01', suffix: 'meeting-standup', title: 'Standup' },
    { date: '2026-09-01', suffix: 'meeting-retro', title: 'Retro' },
  ])
  await flush()
  assert.deepEqual(sidecars.on('2026-09-01'), [
    { suffix: 'meeting-standup', title: 'Standup' },
    { suffix: 'meeting-retro', title: 'Retro' },
  ])

  // `reopen` is the one thing that should blank a listing outright - the
  // vault moved, so what is held is no longer about this vault at all. Kept
  // in the same test, and against the same store, rather than a second
  // `test(...)`: `ipc/host.js` resolves and caches its host once per process,
  // so a second `createSidecars(...)` here would still be talking to this
  // stub regardless of a fresh one being built for it.
  sidecars.reopen()
  assert.deepEqual(sidecars.on('2026-09-01'), [])
})
