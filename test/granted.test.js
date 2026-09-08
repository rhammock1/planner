// @ts-check

/**
 * Who may move which colour, which is a decision with three inputs.
 *
 * It was previously reachable only through a store, and so through a window.
 * The rule it enforces is a consent rule, and a consent rule that can only be
 * checked by opening the app is one nobody checks.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createGranted } from '../src/plugins/granted.js'

const DUSK = `
entry = "index.js"
slots = ["theme.tokens"]

[tokens]
moves = ["paper", "ink"]
`

/** @typedef {import('../src/core/config.js').PluginConfig} PluginConfig */
/** @typedef {{name: string, disabled: boolean}} Standing */

/**
 * @param {Partial<PluginConfig>} [patch]
 * @returns {Map<string, PluginConfig>}
 */
function ticked(patch) {
  return new Map([['dusk', {
    enabled: true,
    approvedSlots: ['theme.tokens'],
    approvedCapabilities: [],
    approvedOpen: [],
    approvedMoves: ['paper', 'ink'],
    approvedRun: new Map(),
    settings: new Map(),
    ...patch,
  }]])
}

/**
 * @param {Map<string, PluginConfig>} plugins
 * @param {Standing[]} [states]
 */
function granted(plugins, states) {
  return createGranted({
    folders: () => [{ name: 'dusk', manifest: DUSK }],
    plugins: () => plugins,
    states: () => states ?? [],
  })
}

test('a plugin ticked for its slot and its colours holds them', () => {
  assert.deepEqual([...granted(ticked()).moves()], [['dusk', ['paper', 'ink']]])
})

test('a colour nobody ticked is not held, however the manifest names it', () => {
  const one = granted(ticked({ approvedMoves: ['paper'] }))
  assert.deepEqual(one.moves().get('dusk'), ['paper'])
})

test('a plugin switched off holds nothing', () => {
  assert.equal(granted(ticked({ enabled: false })).moves().size, 0)
})

test('a plugin whose slot is unticked holds nothing', () => {
  assert.equal(granted(ticked({ approvedSlots: [] })).moves().size, 0)
})

test('a plugin put away for the session holds nothing', () => {
  // The case the rule exists for. A claim is what refuses a *second* plugin
  // the same colour, so one held by a plugin that has been struck three times
  // and closed would refuse a running plugin its colour and put a notice on
  // the page naming a plugin that is not there (spec §3.3).
  const away = granted(ticked(), [
    { name: 'dusk', disabled: true },
  ])
  assert.equal(away.moves().size, 0)

  // And being merely stopped is not being put away - it is `enabled` that
  // says whether a plugin is wanted, and that is the config's business.
  const up = granted(ticked(), [
    { name: 'dusk', disabled: false },
  ])
  assert.deepEqual(up.moves().get('dusk'), ['paper', 'ink'])
})

test('the parse is not repeated while neither file has changed', () => {
  // The reason this is memoized at all: `installed()` parses every manifest in
  // the folder, and it is on the day page's draw path - which is every
  // keystroke in the add row.
  //
  // Identity is the whole test, so the two getters have to hand back the
  // *same* objects until something replaces them. That is what the store does
  // - `folders` and `config` are assigned wholesale in `open()` and not
  // touched otherwise - and a caller that built a fresh array each time would
  // get a correct answer and no memo at all.
  let folders = [{ name: 'dusk', manifest: DUSK }]
  const plugins = ticked()
  const one = createGranted({
    folders: () => folders,
    plugins: () => plugins,
    states: () => [],
  })

  const first = one.installed()
  assert.equal(one.installed(), first, 'the same list was not handed back')

  // Replaced wholesale, the way reading the config again replaces it.
  folders = [{ name: 'dusk', manifest: DUSK }]
  assert.notEqual(one.installed(), first, 'a new folder list was not noticed')
  assert.deepEqual(one.installed()[0]?.moves, ['paper', 'ink'])
})
