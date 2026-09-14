// @ts-check

/**
 * `src/core/boardWrite.js`: the two things the app knows about a card that
 * the plugin is not allowed to - its name, and whether its task finished.
 *
 * Against a vault built from text rather than a fake index, because "the
 * latest day wins" and "a migrated line is not an ending" are properties of
 * how the vault is read, and a fake would let this file believe them without
 * their being true.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { parse } from '../src/core/parse.js'
import { buildIndex } from '../src/core/vaultIndex.js'
import { columnsOf, unnamed, endingFor, placeBoard, archiving } from '../src/core/boardWrite.js'

const BOARD = `# Board

## To do

- Fix the gate ^k4m2qa

## Doing

Waiting on the timber.

- Call the vet ^p9x1bb

## Done

- Water the plants  done 2026-09-10 ^q7r3cc
`

/**
 * @param {Record<string, string>} pages
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function vault(pages) {
  return buildIndex(Object.entries(pages).map(([page, text]) => ({ page, doc: parse(text) })))
}

/**
 * @param {string} name
 * @param {import('../src/core/board.js').Card[]} cards
 * @returns {import('../src/core/board.js').Column}
 */
function column(name, cards) {
  return { name, cards }
}

/**
 * @param {string|null} id
 * @param {number|null} index
 * @param {string} text
 * @param {'done'|'dropped'|null} [ended]
 * @returns {import('../src/core/board.js').Card}
 */
function card(id, index, text, ended = null) {
  return { id, index, text, ended }
}

describe('the columns an answer may name', () => {
  test('are the ones the file has', () => {
    assert.deepEqual(columnsOf(BOARD), ['To do', 'Doing', 'Done'])
  })

  // The same substitution the plugin and the merge both make. A vault that
  // has never had a board still has three columns to put a card in.
  test('and a file that is not there yet has three, not none', () => {
    assert.deepEqual(columnsOf(''), ['To do', 'Doing', 'Done'])
    assert.deepEqual(columnsOf('   \n'), ['To do', 'Doing', 'Done'])
  })

  test('a file nothing can read has no columns, which is not the same as none', () => {
    assert.equal(columnsOf('- A card above every heading ^k4m2qa\n'), null)
  })
})

describe('which cards need a name', () => {
  test('the ones pointed at by line, in answer order', () => {
    const columns = [
      column('To do', [card('k4m2qa', null, 'Fix the gate'), card(null, 4, 'Call the vet')]),
      column('Doing', [card(null, 2, 'Sand the door')]),
    ]
    assert.deepEqual(unnamed(columns, '2026-09-14'), [
      { page: '2026-09-14', at: 4 },
      { page: '2026-09-14', at: 2 },
    ])
  })

  test('and nothing at all when every card came back named', () => {
    assert.deepEqual(unnamed([column('To do', [card('k4m2qa', null, 'Fix the gate')])], '2026-09-14'), [])
  })
})

describe('how a card ended', () => {
  const index = vault({
    '2026-09-14': `# Thursday

- [x] Water the plants ^q7r3cc
- [ ] Fix the gate ^k4m2qa
- [-] Call the vet ^p9x1bb
- [>] Carried away ^m1n2oo
`,
  })

  test('a ticked line is done', () => {
    assert.equal(endingFor(index, 'q7r3cc', null), 'done')
  })

  test('a struck line is dropped, which the archive keeps apart from done', () => {
    assert.equal(endingFor(index, 'p9x1bb', null), 'dropped')
  })

  test('an open line is not an ending', () => {
    assert.equal(endingFor(index, 'k4m2qa', null), null)
  })

  // Unticking is a decision too, and the marker is the app's to take off.
  // Without this a card ticked by accident would stay done until it aged out.
  test('a line that was ticked and is open again takes the marker off', () => {
    assert.equal(endingFor(index, 'k4m2qa', 'done'), null)
  })

  test('a line carried to another day is not an ending either', () => {
    assert.equal(endingFor(index, 'm1n2oo', null), null)
  })

  // Absence is not a decision. Reading it as one would strip the marker off
  // every card whose line somebody deleted.
  test('no line at all keeps whatever the file had', () => {
    assert.equal(endingFor(index, 'zzz999', 'done'), 'done')
    assert.equal(endingFor(index, 'zzz999', null), null)
  })

  test('where two lines hold one name, the later day is the one that counts', () => {
    const both = vault({
      '2026-09-10': '# Thursday\n\n- [x] Fix the gate ^k4m2qa\n',
      '2026-09-14': '# Monday\n\n- [ ] Fix the gate ^k4m2qa\n',
    })
    assert.equal(endingFor(both, 'k4m2qa', null), null)
  })
})

describe('the arrangement the merge is given', () => {
  const index = vault({
    '2026-09-14': `# Monday

- [ ] Fix the gate ^k4m2qa
- [x] Call the vet ^p9x1bb
- [-] Sand the door ^t5u6vv
- [ ] Order the timber
`,
  })

  test('a card pointed at by line takes the name that was minted for it', () => {
    const placed = placeBoard(
      [column('To do', [card(null, 3, 'Order the timber')]), column('Done', [])],
      ['a1b2c3'],
      index,
    )
    assert.deepEqual(placed[0]?.cards, [{ id: 'a1b2c3', text: 'Order the timber', ended: null }])
  })

  test('the names are read in the order unnamed listed them', () => {
    const placed = placeBoard(
      [
        column('To do', [card(null, 3, 'Order the timber')]),
        column('Doing', [card(null, 0, 'Fix the gate')]),
      ],
      ['a1b2c3', 'd4e5f6'],
      index,
    )
    assert.equal(placed[0]?.cards[0]?.id, 'a1b2c3')
    assert.equal(placed[1]?.cards[0]?.id, 'd4e5f6')
  })

  test('a ticked card moves to the last column whatever the answer said', () => {
    const placed = placeBoard(
      [
        column('To do', [card('k4m2qa', null, 'Fix the gate'), card('p9x1bb', null, 'Call the vet')]),
        column('Done', []),
      ],
      [],
      index,
    )
    assert.deepEqual(placed[0]?.cards.map((one) => one.id), ['k4m2qa'])
    assert.deepEqual(placed[1]?.cards, [{ id: 'p9x1bb', text: 'Call the vet', ended: 'done' }])
  })

  // A struck line is a decision that was made, not a completion, and the
  // column it was in is where that decision is legible.
  test('a struck card is marked where it stands, and is not moved', () => {
    const placed = placeBoard(
      [column('To do', [card('t5u6vv', null, 'Sand the door')]), column('Done', [])],
      [],
      index,
    )
    assert.deepEqual(placed[0]?.cards, [{ id: 't5u6vv', text: 'Sand the door', ended: 'dropped' }])
    assert.deepEqual(placed[1]?.cards, [])
  })

  test("the ending is the vault's and not the plugin's", () => {
    const placed = placeBoard(
      [column('To do', [card('k4m2qa', null, 'Fix the gate', 'done')]), column('Done', [])],
      [],
      index,
    )
    assert.equal(placed[0]?.cards[0]?.ended, null, 'the plugin said done; the line is open')
  })

  test('a board cut down to one column still has somewhere to put a finished card', () => {
    const placed = placeBoard([column('Everything', [card('p9x1bb', null, 'Call the vet')])], [], index)
    assert.deepEqual(placed[0]?.cards.map((one) => one.ended), ['done'])
  })

  test('an answer with no columns is an arrangement with no columns, not an invented one', () => {
    assert.deepEqual(placeBoard([], [], index), [])
  })
})

describe('what goes into the archive', () => {
  test('the card the file holds, with the marker the app wrote', () => {
    const { cards, notices } = archiving(BOARD, ['q7r3cc'])
    assert.deepEqual(cards, [
      { id: 'q7r3cc', text: 'Water the plants', ended: 'done', endedOn: '2026-09-10' },
    ])
    assert.deepEqual(notices, [])
  })

  test('nothing asked for is nothing read', () => {
    assert.deepEqual(archiving(BOARD, []).cards, [])
  })

  test('a name the file does not hold is not a card to archive', () => {
    assert.deepEqual(archiving(BOARD, ['zzz999']).cards, [])
  })

  // The archive is append-only and a card taken off the board is off it for
  // good, so this is the one place a plugin could delete a task outright.
  test('a card nothing has finished is refused and said out loud', () => {
    const { cards, notices } = archiving(BOARD, ['k4m2qa'])
    assert.deepEqual(cards, [])
    assert.deepEqual(notices, ['the board asked to archive 1 card nothing has finished'])
  })

  test('two of them are one sentence, not two', () => {
    const { notices } = archiving(BOARD, ['k4m2qa', 'p9x1bb'])
    assert.deepEqual(notices, ['the board asked to archive 2 cards nothing has finished'])
  })

  test('in file order, so the archive reads in board order', () => {
    const board = `# Board

## To do

- One ^aaa111

## Done

- Two  done 2026-09-10 ^bbb222
- Three  dropped 2026-09-11 ^ccc333
`
    const { cards } = archiving(board, ['ccc333', 'bbb222'])
    assert.deepEqual(cards.map((one) => one.id), ['bbb222', 'ccc333'])
  })

  // The first entry, the same rule the draw and the merge both follow. A file
  // holding one name twice would otherwise put one line in the archive twice
  // from a single ending, into a file no later write can correct.
  test('a name the file holds twice is one card, the first', () => {
    const twice = `# Board

## Doing

- The first one  done 2026-09-10 ^bbb222

## Done

- The second one  done 2026-09-11 ^bbb222
`
    const { cards } = archiving(twice, ['bbb222'])
    assert.deepEqual(cards.map((one) => one.text), ['The first one'])
  })

  test('a file nothing can read archives nothing rather than guessing', () => {
    assert.deepEqual(archiving('- A card above every heading ^k4m2qa\n', ['k4m2qa']).cards, [])
  })
})
