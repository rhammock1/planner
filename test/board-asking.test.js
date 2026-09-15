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
import { boardsFor, cardBadgesFor } from '../src/plugins/pageAsking.js'
import { cardMarkKey } from '../src/core/board.js'
import { badgeKey, linesOf } from '../src/core/badges.js'
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

/**
 * A board, as `boardsFor` would have returned it, for the questions `§8` puts
 * about its cards rather than about the day.
 *
 * @param {string} name
 * @param {import('../src/core/board.js').Card[]} cards
 * @returns {any}
 */
function board(name, cards) {
  return {
    plugin: name,
    tab: name,
    board: '',
    answer: { columns: [{ name: 'To do', cards }], archive: [] },
  }
}

/**
 * @param {string} text
 * @param {string|null} [id]
 * @returns {import('../src/core/board.js').Card}
 */
function card(text, id = null) {
  return { id, index: id === null ? 0 : null, text, ended: null }
}

const NOTE = 'sidecar:2026-09-01/note'

describe('a card asks about itself', () => {
  test('the cards of the board, not the lines of the day', () => {
    const { store, asked } = storeWith({ installed: [plugin('kanban')] })
    // Deliberately nothing this page has a line for: a card that has sat in a
    // column since Friday is exactly the case the day's own question misses.
    cardBadgesFor(store, '2026-09-01', [board('kanban', [
      card('Ship the release notes', 'aaa111'),
      card('Call the vet', 'bbb222'),
    ])])

    const put = asked.filter((one) => one.slot === 'item.badge')
    assert.equal(put.length, 1, 'the board s cards were not asked about once')
    assert.deepEqual(put[0]?.params.items, [
      { index: 0, text: 'Ship the release notes', id: 'aaa111' },
      { index: 1, text: 'Call the vet', id: 'bbb222' },
    ])
    // The day is still the day: a note is found by looking back from it.
    assert.equal(put[0]?.params.date, '2026-09-01')
  })

  test('and a marker comes back on the card it was asked under', () => {
    const first = card('Ship the release notes', 'aaa111')
    const second = card('Call the vet', 'bbb222')
    const cards = [first, second]
    const { store } = storeWith({
      installed: [plugin('kanban')],
      answer: (slot) => slot !== 'item.badge' ? [] : [{
        plugin: 'notes',
        value: [{ index: 1, label: 'note', href: NOTE }],
      }],
    })
    const { badges } = cardBadgesFor(store, '2026-09-01', [board('kanban', cards)])

    assert.deepEqual([...badges.keys()], [cardMarkKey('kanban', second)])
    assert.deepEqual(badges.get(cardMarkKey('kanban', second)), [
      { plugin: 'notes', label: 'note', href: NOTE },
    ])
  })

  test('a card the answer pointed at by line is asked about by its words', () => {
    // It has no id to be asked under and does not need one: a note is found by
    // what the task says, and the name a card is waiting for is not part of it.
    const { store, asked } = storeWith({ installed: [plugin('kanban')] })
    cardBadgesFor(store, '2026-09-01', [board('kanban', [card('Water the plants')])])
    const put = asked.filter((one) => one.slot === 'item.badge')
    assert.deepEqual(put[0]?.params.items, [{ index: 0, text: 'Water the plants', id: null }])
  })

  test('a marker that leads out of the vault is not one a card draws', () => {
    const cards = [card('Review PR #4412', 'aaa111')]
    const { store } = storeWith({
      installed: [plugin('kanban')],
      answer: (slot) => slot !== 'item.badge' ? [] : [{
        plugin: 'forge',
        value: [{ index: 0, label: '#4412', href: 'https://example.com/pr/4412' }],
      }],
    })
    const { badges } = cardBadgesFor(store, '2026-09-01', [board('kanban', cards)])
    // Not a refusal of the plugin - the same marker still belongs on the day
    // page, where there is room for it. A card has room for the note and no
    // more, and what makes it the note is where it leads.
    assert.equal(badges.size, 0)
  })

  test('and the same card with a marker into the vault draws one', () => {
    const cards = [card('Review PR #4412', 'aaa111')]
    const { store } = storeWith({
      installed: [plugin('kanban')],
      answer: (slot) => slot !== 'item.badge' ? [] : [{
        plugin: 'task-notes',
        value: [{ index: 0, label: 'note', href: NOTE }],
      }],
    })
    const { badges } = cardBadgesFor(store, '2026-09-01', [board('kanban', cards)])
    assert.equal(badges.size, 1)
  })

  test('two boards are two questions, and neither of them is the day s', () => {
    const { store, asked } = storeWith({ installed: [plugin('kanban'), plugin('later')] })
    cardBadgesFor(store, '2026-09-01', [
      board('kanban', [card('Ship the release notes', 'aaa111')]),
      board('later', [card('Ship the release notes', 'aaa111')]),
    ])

    const keys = asked.filter((one) => one.slot === 'item.badge').map((one) => one.key)
    assert.equal(keys.length, 2, 'two boards did not put two questions')
    assert.notEqual(keys[0], keys[1], 'two boards shared one cache entry')
    // The same cards in both, so what separates them is the board's own name -
    // without it the second board would answer with the first board's markers.
    assert.ok(keys[0]?.startsWith('board:kanban:'))
    assert.ok(keys[1]?.startsWith('board:later:'))

    // And the day's, which is the entry a board must not evict: the day page
    // is still behind the board and gets its markers back when it closes.
    const day = badgeKey('2026-09-01', linesOf(parse(PAGE)))
    assert.ok(!keys.includes(day), 'a board asked the day s own question')
  })

  test('a board that has not answered is not asked about', () => {
    const { store, asked } = storeWith({ installed: [plugin('kanban')] })
    cardBadgesFor(store, '2026-09-01', [{ plugin: 'kanban', tab: 'kanban', board: '', answer: null }])
    assert.equal(asked.filter((one) => one.slot === 'item.badge').length, 0)
  })

  test('a notice about a card says which board it is about', () => {
    const { store } = storeWith({
      installed: [plugin('kanban', { tab: 'Board' })],
      answer: (slot) => slot !== 'item.badge' ? [] : [{ plugin: 'notes', value: 'not a list' }],
    })
    const { notices } = cardBadgesFor(store, '2026-09-01', [
      board('kanban', [card('Review PR #4412', 'aaa111')]),
    ])
    assert.deepEqual(notices, ['kanban: notes returned something that is not a list'])
  })
})
