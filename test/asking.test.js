// @ts-check

/**
 * Which plugins are up, what has been asked of them, and what is kept.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createAsking } from '../src/plugins/asking.js'

/**
 * A stub host that records what it was asked and lets a test answer whenever
 * it likes - which is the whole point: a plugin answers when it answers.
 */
function host() {
  /** @type {{slot: string, params: any, settle: (answers: any[]) => void}[]} */
  const asked = []
  /** @type {{name: string, slots: string[]}[]} */
  const started = []
  /** @type {string[]} */
  const stopped = []
  let drawn = 0

  const deps = {
    startPlugin: async (/** @type {string} */ name, /** @type {string} */ _entry, /** @type {string[]} */ slots) => {
      started.push({ name, slots })
    },
    stopPlugin: async (/** @type {string} */ name) => { stopped.push(name) },
    askPlugins: (/** @type {string} */ slot, /** @type {any} */ _now, /** @type {any} */ params) =>
      new Promise((resolve) => {
        asked.push({ slot, params, settle: (answers) => resolve({ answers, notices: [] }) })
      }),
    pluginStates: async () => [],
    now: () => ({ date: '2026-09-02', time: '10:00' }),
    onChanged: () => { drawn += 1 },
  }

  return { deps, asked, started, stopped, drawn: () => drawn }
}

const MANIFEST = `
entry = "index.js"
slots = ["item.badge"]
`

/** @param {string[]} [approvedSlots] */
function configured(approvedSlots) {
  return new Map([['ticket-links', {
    enabled: true,
    approvedSlots: approvedSlots ?? ['item.badge'],
    approvedCapabilities: [],
  }]])
}

const FOLDERS = [{ name: 'ticket-links', manifest: MANIFEST }]

/** Waits out every microtask a settled promise chain set off, not just a
 *  fixed count of them - `run`'s second draw is a hop further than a plain
 *  `await Promise.resolve()` reaches. @returns {Promise<void>} */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('a sync starts what the config enables', async () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  await asking.sync(FOLDERS, configured())
  assert.deepEqual(stub.started, [{ name: 'ticket-links', slots: ['item.badge'] }])
})

test('syncing twice with nothing changed starts nothing twice', async () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  await asking.sync(FOLDERS, configured())
  await asking.sync(FOLDERS, configured())
  assert.equal(stub.started.length, 1)
  assert.deepEqual(stub.stopped, [])
})

test('a changed approval stops the plugin and starts it again', async () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  await asking.sync(FOLDERS, configured())
  await asking.sync(FOLDERS, configured([]))
  assert.deepEqual(stub.stopped, ['ticket-links'])
  assert.equal(stub.started.length, 2)
  assert.deepEqual(stub.started[1]?.slots, [])
})

test('switching a plugin off stops it', async () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  await asking.sync(FOLDERS, configured())
  await asking.sync(FOLDERS, new Map())
  assert.deepEqual(stub.stopped, ['ticket-links'])
})

test('the first ask for a key comes back empty and asks', () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  assert.deepEqual(asking.answers('item.badge', 'k1', { date: '2026-09-02' }), [])
  assert.equal(stub.asked.length, 1)
  assert.equal(stub.asked[0]?.slot, 'item.badge')
})

test('an answer that lands for the current key is kept and drawn', async () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  asking.answers('item.badge', 'k1', {})
  stub.asked[0]?.settle([{ plugin: 'ticket-links', value: [{ index: 0 }] }])
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(asking.answers('item.badge', 'k1', {}), [
    { plugin: 'ticket-links', value: [{ index: 0 }] },
  ])
  // Asked once, not twice: the second call was a hit.
  assert.equal(stub.asked.length, 1)
  assert.ok(stub.drawn() > 0)
})

test('the same key asked again while the first is in flight asks once', () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  asking.answers('item.badge', 'k1', {})
  asking.answers('item.badge', 'k1', {})
  assert.equal(stub.asked.length, 1)
})

test('an answer lands under its own key, and never against another', async () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  asking.answers('item.badge', 'k1', {})
  // The lines changed before the plugin answered, so a second question is in
  // the air for the same slot.
  asking.answers('item.badge', 'k2', {})
  assert.equal(stub.asked.length, 2)

  stub.asked[0]?.settle([{ plugin: 'ticket-links', value: ['for k1'] }])
  await Promise.resolve()
  await Promise.resolve()

  // Not drawn against k2, which is what is on screen.
  assert.deepEqual(asking.answers('item.badge', 'k2', {}), [])
  assert.deepEqual(asking.answers('item.badge', 'k1', {}), [
    { plugin: 'ticket-links', value: ['for k1'] },
  ])
})

test('the week asking for seven pages at once keeps all seven answers', async () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  for (const key of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']) {
    asking.answers('item.badge', key, {})
  }
  assert.equal(stub.asked.length, 7)
  for (const [at, one] of stub.asked.entries()) one.settle([{ plugin: 'p', value: [at] }])
  await Promise.resolve()
  await Promise.resolve()

  for (const [at, key] of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].entries()) {
    assert.deepEqual(asking.answers('item.badge', key, {}), [{ plugin: 'p', value: [at] }])
  }
  // Seven questions, not fourteen: the second pass was all hits.
  assert.equal(stub.asked.length, 7)
})

test('a refresh moves the generation, which a key can be built from', () => {
  const stub = host()
  const asking = createAsking(stub.deps)
  const first = asking.generation()
  asking.refresh()
  assert.notEqual(asking.generation(), first)
})

test('what went wrong asking is a notice, and is replaced rather than piled up', async () => {
  const stub = host()
  const asking = createAsking({
    ...stub.deps,
    askPlugins: async () => ({ answers: [], notices: ['ticket-links did not answer within 2s'] }),
  })
  asking.answers('item.badge', 'k1', {})
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(asking.notices(), ['ticket-links did not answer within 2s'])

  asking.answers('item.badge', 'k2', {})
  await Promise.resolve()
  await Promise.resolve()
  // Still one line. Asked again every time the popover opens, a notice that
  // accumulated would leave a page that was all notice.
  assert.deepEqual(asking.notices(), ['ticket-links did not answer within 2s'])
})

test('a landed answer draws at once, then again once plugin states are fresh', async () => {
  const stub = host()
  /** @type {{name: string, running: boolean, disabled: boolean, reason: string|null}[]} */
  let live = []
  const asking = createAsking({ ...stub.deps, pluginStates: async () => live })

  asking.answers('item.badge', 'k1', {})
  // The plugin missed its deadline answering, which is exactly the kind of
  // thing the redraw after this one has to catch up on.
  live = [{ name: 'ticket-links', running: false, disabled: true, reason: 'missed its deadline' }]
  stub.asked[0]?.settle([{ plugin: 'ticket-links', value: [] }])
  await flush()

  assert.equal(stub.drawn(), 2)
  assert.deepEqual(asking.states(), live)
})

test('a stop that is refused is not paired with a start, and is retried next sync', async () => {
  const stub = host()
  let refuse = false
  const asking = createAsking({
    ...stub.deps,
    stopPlugin: async (name) => {
      if (refuse) throw new Error('the window would not close')
      stub.stopped.push(name)
    },
  })
  await asking.sync(FOLDERS, configured())
  assert.equal(stub.started.length, 1)

  // The approval changes, so this plugin needs restarting - and its stop
  // will not go.
  refuse = true
  await asking.sync(FOLDERS, configured([]))
  assert.deepEqual(stub.stopped, [])
  // No start under the name the old window still holds (spec: gate the retry
  // on the rejected stopPlugin promise, not on plugin_states().running).
  assert.equal(stub.started.length, 1)

  // The window closes this time, so the same stop - not a fresh diff -
  // finally goes through, and only then does the restart happen.
  refuse = false
  await asking.sync(FOLDERS, configured([]))
  assert.deepEqual(stub.stopped, ['ticket-links'])
  assert.equal(stub.started.length, 2)
  assert.deepEqual(stub.started[1]?.slots, [])
})

test('two overlapping syncs start each plugin once, not twice', async () => {
  const stub = host()
  const asking = createAsking(stub.deps)

  // Neither is awaited before the other starts: the boot sync and a
  // settings-pane save landing while it is still running.
  const first = asking.sync(FOLDERS, configured())
  const second = asking.sync(FOLDERS, configured())
  await Promise.all([first, second])

  assert.equal(stub.started.length, 1)
  assert.deepEqual(stub.stopped, [])
})
