// @ts-check
// See the note at the top of `test/sidecar-store.test.js`: this reference is
// program-wide rather than file-scoped, and is accepted for the same reason.
// This file is checked under `tsconfig.web.json` because `pageAsking.js`
// reaches the IPC seam, and the seam is DOM.
/// <reference types="node" />

/**
 * `boardsFor` in `src/plugins/pageAsking.js`: which plugins get a board, what
 * each is shown of the others' (nothing), and that all of them are asked once.
 *
 * Against a hand-built store rather than a real one, because what is being
 * tested is the question this function composes - not the cache under it,
 * which `asking.test.js` covers.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { parse } from '../src/core/parse.js'
import { boardsFor } from '../src/plugins/pageAsking.js'
import { moveCard } from '../src/core/boardWrite.js'

const PAGE = `- [ ] Review PR #4412 @14:00
- [x] Water the plants ^k4m2qa
- [>] Carried away >2026-09-03
`

/**
 * @param {object} options
 * @param {any[]} options.installed
 * @param {Record<string, string>} [options.files]  a plugin's board, by name
 * @param {(slot: string, key: string, params: any) => {plugin: string, value: unknown}[]} [options.answer]
 * @returns {{store: any, asked: {slot: string, key: string, params: any}[]}}
 */
function storeWith({ installed, files = {}, answer = () => [] }) {
  /** @type {{slot: string, key: string, params: any}[]} */
  const asked = []
  const store = {
    page: () => parse(PAGE),
    installed: () => installed,
    pluginFile: (/** @type {string} */ name, /** @type {string} */ file) =>
      files[`${name}/${file}`] ?? null,
    pluginAnswers: (/** @type {string} */ slot, /** @type {string} */ key, /** @type {any} */ params) => {
      asked.push({ slot, key, params })
      return answer(slot, key, params)
    },
  }
  return { store, asked }
}

/**
 * @param {string} name
 * @param {Partial<{enabled: boolean, approvedSlots: string[], tab: string}>} [over]
 * @returns {any}
 */
function plugin(name, over = {}) {
  return {
    name,
    tab: name,
    enabled: true,
    approvedSlots: ['spread.board'],
    ...over,
  }
}

describe('who gets a board', () => {
  test('a plugin whose slot is ticked', () => {
    const { store, asked } = storeWith({ installed: [plugin('kanban')] })
    const { boards } = boardsFor(store, '2026-09-01')
    assert.deepEqual(boards.map((one) => one.plugin), ['kanban'])
    assert.equal(asked.length, 1)
    assert.equal(asked[0]?.slot, 'spread.board')
  })

  test('not one that is switched off, and not one nobody ticked', () => {
    const { store, asked } = storeWith({
      installed: [
        plugin('sleeping', { enabled: false }),
        plugin('unticked', { approvedSlots: [] }),
      ],
    })
    assert.deepEqual(boardsFor(store, '2026-09-01').boards, [])
    // Nothing to ask about, so nothing is asked at all.
    assert.equal(asked.length, 0)
  })

  // The §2.5 rule, where it costs something. `plan` already says so in the
  // pane; here the plugin simply has no tab, because a board is kept in a
  // folder and this one has nowhere to keep it.
  test('not one whose name cannot be a folder in the vault', () => {
    const { store } = storeWith({ installed: [plugin('2026'), plugin('kanban')] })
    assert.deepEqual(boardsFor(store, '2026-09-01').boards.map((one) => one.plugin), ['kanban'])
  })

  test('in the order the plugins are listed, so a strip of tabs settles', () => {
    const { store } = storeWith({
      installed: [plugin('zebra'), plugin('apple'), plugin('kanban')],
    })
    assert.deepEqual(
      boardsFor(store, '2026-09-01').boards.map((one) => one.plugin),
      ['zebra', 'apple', 'kanban'],
    )
  })
})

describe('what a board is shown', () => {
  test('the day, its lines, and its own file', () => {
    const { store, asked } = storeWith({
      installed: [plugin('kanban')],
      files: { 'kanban/board': '## To do\n- A ^k4m2qa\n' },
    })
    boardsFor(store, '2026-09-01')

    const params = asked[0]?.params
    assert.equal(params.date, '2026-09-01')
    assert.deepEqual(params.items.map((/** @type {any} */ line) => line.text), [
      'Review PR #4412',
      'Water the plants',
      'Carried away',
    ])
    assert.deepEqual(params.per, { kanban: { board: '## To do\n- A ^k4m2qa\n' } })
  })

  test('a file that is not there yet is an empty board, not a missing one', () => {
    const { store, asked } = storeWith({ installed: [plugin('kanban')] })
    boardsFor(store, '2026-09-01')
    assert.deepEqual(asked[0]?.params.per, { kanban: { board: '' } })
  })

  // The `per` table is what keeps one plugin from learning another exists.
  // The envelope drops every entry but the asker's (`waiting.rs`), so what
  // matters here is that each name is in the table exactly once, under its
  // own board.
  test('every board goes out in its own entry, and no plugin shares one', () => {
    const { store, asked } = storeWith({
      installed: [plugin('kanban'), plugin('scrum')],
      files: { 'kanban/board': 'kanban says', 'scrum/board': 'scrum says' },
    })
    boardsFor(store, '2026-09-01')
    assert.equal(asked.length, 1, 'asked once per plugin rather than once')
    assert.deepEqual(asked[0]?.params.per, {
      kanban: { board: 'kanban says' },
      scrum: { board: 'scrum says' },
    })
  })

  test('the question carries no kind and no now - the envelope writes those', () => {
    const { store, asked } = storeWith({ installed: [plugin('kanban')] })
    boardsFor(store, '2026-09-01')
    assert.equal('kind' in (asked[0]?.params ?? {}), false)
    assert.equal('now' in (asked[0]?.params ?? {}), false)
  })
})

describe('when a board is asked again', () => {
  /** @param {Record<string, string>} files */
  const keyFor = (files) => {
    const { store, asked } = storeWith({
      installed: [plugin('kanban'), plugin('scrum')],
      files,
    })
    boardsFor(store, '2026-09-01')
    return String(asked[0]?.key)
  }

  test('when one of the boards changes', () => {
    const before = keyFor({ 'kanban/board': 'one' })
    assert.notEqual(before, keyFor({ 'kanban/board': 'two' }))
    assert.equal(before, keyFor({ 'kanban/board': 'one' }))
  })

  test('and when the other does, which a single shared file would have missed', () => {
    const before = keyFor({ 'kanban/board': 'one', 'scrum/board': 'a' })
    assert.notEqual(before, keyFor({ 'kanban/board': 'one', 'scrum/board': 'b' }))
  })

  // What keeps a drag from being undone, written as a test because it is a
  // property of *this* key that code in `boardWrites.js` depends on and
  // cannot see. The merge fills a vacancy from the plugin's last answer, and
  // that answer holds the board from before the drop - so were this key the
  // day alone, the next draw would re-use it and put the card back. It is not
  // the day alone: the file's own text is in it, the drop rewrites the file,
  // and the plugin is asked again about the board it now has.
  test('when a card has been dragged into another column', () => {
    const board = '# Board\n\n## To do\n\n- Order the timber ^40ries\n\n## Doing\n\n## Done\n'
    const dropped = moveCard(board, '40ries', 'Doing', null)
    assert.notEqual(dropped, null)
    assert.notEqual(keyFor({ 'kanban/board': board }), keyFor({ 'kanban/board': String(dropped) }))
  })
})

describe('what comes back', () => {
  test('each plugin is handed its own answer and nobody else\'s', () => {
    const { store } = storeWith({
      installed: [plugin('kanban'), plugin('scrum')],
      answer: () => [
        { plugin: 'kanban', value: { columns: [{ name: 'To do', cards: [{ index: 0, text: 'A' }] }] } },
        { plugin: 'scrum', value: { columns: [{ name: 'Doing', cards: [] }] } },
      ],
    })
    const { boards } = boardsFor(store, '2026-09-01')
    assert.deepEqual(boards[0]?.answer?.columns.map((one) => one.name), ['To do'])
    assert.deepEqual(boards[1]?.answer?.columns.map((one) => one.name), ['Doing'])
  })

  test('a plugin that has not answered yet still has a tab', () => {
    const { store } = storeWith({ installed: [plugin('kanban', { tab: 'Board' })] })
    const { boards } = boardsFor(store, '2026-09-01')
    assert.deepEqual(boards, [{ plugin: 'kanban', tab: 'Board', board: '', answer: null }])
  })

  test('a notice says which board it is about', () => {
    const { store } = storeWith({
      installed: [plugin('kanban', { tab: 'Board' })],
      answer: () => [{ plugin: 'kanban', value: { columns: 'not a list' } }],
    })
    const { notices } = boardsFor(store, '2026-09-01')
    assert.deepEqual(notices, ['Board: the board returned no columns'])
  })
})
