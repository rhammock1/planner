// @ts-check

/**
 * The `planner` object a plugin is given.
 *
 * Not a security boundary - a plugin can rewrite every line of it - but it is
 * a contract, and `docs/plugins.md` promises it. Evaluated here against a stub
 * window, which is all it ever touches.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../src/plugins/runtime.js', import.meta.url), 'utf8')

/**
 * Runs the runtime against a fresh stub window and hands back the globals it
 * installed, plus every message it tried to send.
 *
 * @returns {{planner: any, host: any, sent: any[]}}
 */
function load() {
  /** @type {any[]} */
  const sent = []
  /** @type {any} */
  const window = {
    __TAURI_INTERNALS__: {
      /** @param {string} command @param {any} args */
      invoke: (command, args) => {
        sent.push({ command, ...args })
        return Promise.resolve(null)
      },
    },
  }
  // The file's own IIFE, given a `window` and nothing else.
  new Function('window', SOURCE)(window)
  return { planner: window.planner, host: window.__planner, sent }
}

test('a handler registers under the slot it names', async () => {
  const { planner, host, sent } = load()
  planner.on('item.badge', () => [{ index: 0, label: '#1', href: 'https://x/1' }])

  await host.request({ id: 7, kind: 'item.badge', now: { date: '2026-09-02', time: '10:00' } })

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.message.kind, 'reply')
  assert.equal(sent[0]?.message.id, 7)
  assert.deepEqual(sent[0]?.message.value, [{ index: 0, label: '#1', href: 'https://x/1' }])
})

test('onContribute is the vault.contribute slot under its old name', async () => {
  const { planner, host, sent } = load()
  planner.onContribute(() => [{ date: '2026-09-02', time: null, text: 'Standup' }])

  await host.request({ id: 1, kind: 'vault.contribute', now: { date: '2026-09-02', time: '09:00' } })
  assert.equal(sent[0]?.message.kind, 'reply')

  // And under the name the host used to send, so a plugin written against the
  // old host is not broken by a rename it never saw.
  await host.request({ id: 2, kind: 'contribute', now: { date: '2026-09-02', time: '09:00' } })
  assert.equal(sent[1]?.message.kind, 'reply')
})

test('the handler is given the whole question, including the time', async () => {
  const { planner, host } = load()
  /** @type {any} */
  let seen = null
  planner.on('item.badge', (/** @type {any} */ message) => { seen = message; return [] })

  await host.request({
    id: 3, kind: 'item.badge', now: { date: '2026-09-02', time: '16:20' },
    date: '2026-09-02', items: [{ index: 0, text: 'Review PR #4412' }],
  })

  assert.deepEqual(seen.now, { date: '2026-09-02', time: '16:20' })
  assert.deepEqual(seen.items, [{ index: 0, text: 'Review PR #4412' }])
})

test('ready says which slots actually registered', async () => {
  const { planner, host, sent } = load()
  planner.on('item.badge', () => [])
  planner.onContribute(() => [])

  await host.ready()

  assert.equal(sent[0]?.message.kind, 'ready')
  // Sorted, so the host compares two lists rather than two orders.
  assert.deepEqual(sent[0]?.message.slots, ['item.badge', 'vault.contribute'])
})

test('a plugin that registers nothing still says ready', async () => {
  const { host, sent } = load()
  await host.ready()
  assert.deepEqual(sent[0]?.message.slots, [])
})

test('a question nothing answers comes back as a failure, not a silence', async () => {
  const { host, sent } = load()
  await host.request({ id: 4, kind: 'item.badge', now: { date: '2026-09-02', time: '10:00' } })
  assert.equal(sent[0]?.message.kind, 'failed')
  assert.match(String(sent[0]?.message.error), /item\.badge/)
})

test('a handler that throws comes back as a failure', async () => {
  const { planner, host, sent } = load()
  planner.on('item.badge', () => { throw new Error('regex went for a walk') })
  await host.request({ id: 5, kind: 'item.badge', now: { date: '2026-09-02', time: '10:00' } })
  assert.equal(sent[0]?.message.kind, 'failed')
  assert.match(String(sent[0]?.message.error), /went for a walk/)
})

test('registering a slot twice replaces the handler rather than answering twice', async () => {
  const { planner, host, sent } = load()
  planner.on('item.badge', () => ['first'])
  planner.on('item.badge', () => ['second'])
  await host.request({ id: 6, kind: 'item.badge', now: { date: '2026-09-02', time: '10:00' } })
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0]?.message.value, ['second'])
})
