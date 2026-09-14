// @ts-check
// See the note at the top of `test/board-asking.test.js`: checked under
// `tsconfig.web.json` because the store this leans on reaches the IPC seam.
/// <reference types="node" />

/**
 * `keepBoards` in `src/plugins/boardWrites.js`: the three files one answer can
 * change, and the order they change in.
 *
 * Against a hand-built store that records its writes, because what is being
 * tested is which write happens, when, and in what order - not the queue
 * under it, which `board-store.test.js` covers. The vault inside the fake is
 * a real index built from real text, because "a ticked line moves the card"
 * is a claim about how a page parses.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { parse } from '../src/core/parse.js'
import { serialize } from '../src/core/serialize.js'
import { buildIndex } from '../src/core/vaultIndex.js'
import { keepBoards } from '../src/plugins/boardWrites.js'

const PAGE = '2026-09-14'

const BOARD = `# Board

## To do

- Fix the gate ^k4m2qa

## Doing

Waiting on the timber.

- Call the vet ^p9x1bb

## Done
`

/**
 * @param {object} options
 * @param {string} [options.page]  the day page's text
 * @param {string|null} [options.board]  `board.md`, null for "nobody has read it"
 * @param {string|null} [options.archive]  `archive.md`, null for the same
 * @param {boolean} [options.writes]  whether a write is allowed to land
 * @returns {{store: any, wrote: [string, string][], pages: Record<string, string>, notices: string[]}}
 */
function storeWith({ page = '# Monday\n', board = BOARD, archive = '', writes = true } = {}) {
  /** @type {Record<string, string>} */
  const pages = { [PAGE]: page }
  /** @type {[string, string][]} */
  const wrote = []
  /** @type {string[]} */
  const notices = []
  /** @type {Record<string, string|null>} */
  const files = { board, archive }

  const index = () => buildIndex(
    Object.entries(pages).map(([key, text]) => ({ page: key, doc: parse(text) })),
  )

  const store = {
    vault: index,
    freshest: index,
    page: (/** @type {string} */ key) => parse(pages[key] ?? ''),
    notice: (/** @type {string} */ line) => { notices.push(line) },
    pluginFileKnown: (/** @type {string} */ _name, /** @type {string} */ file) =>
      files[file] !== null,
    pluginFile: (/** @type {string} */ _name, /** @type {string} */ file) => files[file] ?? null,
    changePluginFile: async (
      /** @type {string} */ _name,
      /** @type {string} */ file,
      /** @type {string} */ text,
    ) => {
      if (!writes) return false
      wrote.push([file, text])
      files[file] = text
      return true
    },
    change: async (
      /** @type {string} */ key,
      /** @type {(doc: any) => any} */ mutate,
    ) => {
      if (!writes) return false
      const next = mutate(parse(pages[key] ?? ''))
      if (next === null) return false
      pages[key] = serialize(next)
      return true
    },
  }
  return { store, wrote, pages, notices }
}

/**
 * @param {object} over
 * @returns {import('../src/plugins/pageAsking.js').Board}
 */
function board(over = {}) {
  return {
    plugin: 'kanban',
    tab: 'Kanban',
    board: BOARD,
    answer: { columns: [], archive: [] },
    ...over,
  }
}

/**
 * @param {string} name
 * @param {{id?: string|null, index?: number|null, text: string, ended?: 'done'|'dropped'|null}[]} cards
 * @returns {import('../src/core/board.js').Column}
 */
function column(name, cards) {
  return {
    name,
    cards: cards.map((one) => ({
      id: one.id ?? null,
      index: one.index ?? null,
      text: one.text,
      ended: one.ended ?? null,
    })),
  }
}

/** The board exactly as the file has it, which is the answer of a plugin that
 *  rearranged nothing. */
const UNCHANGED = [
  column('To do', [{ id: 'k4m2qa', text: 'Fix the gate' }]),
  column('Doing', [{ id: 'p9x1bb', text: 'Call the vet' }]),
  column('Done', []),
]

describe('a draw that changes nothing', () => {
  test('writes nothing at all', async () => {
    const { store, wrote } = storeWith()
    await keepBoards(store, PAGE, [board({ answer: { columns: UNCHANGED, archive: [] } })], '2026-09-14')
    assert.deepEqual(wrote, [])
  })

  test('and a board that has not answered is not a board to write', async () => {
    const { store, wrote } = storeWith()
    await keepBoards(store, PAGE, [board({ answer: null })], '2026-09-14')
    assert.deepEqual(wrote, [])
  })

  // The read is already in the air; the draw it lands on is the one that
  // writes. Writing now would replace somebody's board with the board it
  // would have had if they had never kept one.
  test('and a file nobody has read yet is not written over', async () => {
    const { store, wrote } = storeWith({ board: null })
    await keepBoards(store, PAGE, [board({ answer: { columns: UNCHANGED, archive: [] } })], '2026-09-14')
    assert.deepEqual(wrote, [])
  })
})

describe('a draw whose day is not today', () => {
  const page = `# Monday

- [ ] Order the timber
`

  /** An answer that would certainly write: a line to name, and the board to
   *  rewrite with the name in it. */
  const naming = () => board({
    answer: {
      columns: [
        column('To do', [{ id: 'k4m2qa', text: 'Fix the gate' }, { index: 2, text: 'Order the timber' }]),
        column('Doing', [{ id: 'p9x1bb', text: 'Call the vet' }]),
        column('Done', []),
      ],
      archive: [],
    },
  })

  // A draw that reads its clock twice can straddle midnight: the answer was
  // decided against one day and this would write the ids into the other day's
  // page. Dropping the draw costs a minute; the name would have been minted
  // on a page nobody was looking at.
  test('writes nothing, and names nothing', async () => {
    const { store, wrote, pages } = storeWith({ page })
    await keepBoards(store, PAGE, [naming()], '2026-09-15')
    assert.deepEqual(wrote, [])
    assert.equal(pages[PAGE], page)
  })

  test('and says nothing about it, because the next draw does the work', async () => {
    const { store, notices } = storeWith({ page })
    await keepBoards(store, PAGE, [naming()], '2026-09-15')
    assert.deepEqual(notices, [])
  })

  test('where the same answer on the day it was asked about does write', async () => {
    const { store, wrote } = storeWith({ page })
    await keepBoards(store, PAGE, [naming()], PAGE)
    assert.notDeepEqual(wrote, [])
  })
})

describe('a card the answer pointed at by line', () => {
  const page = `# Monday

- [ ] Order the timber
`

  test('is named on the day page, and the board gets the name', async () => {
    const { store, wrote, pages } = storeWith({ page })
    await keepBoards(store, PAGE, [board({
      answer: {
        columns: [
          column('To do', [{ id: 'k4m2qa', text: 'Fix the gate' }, { index: 2, text: 'Order the timber' }]),
          column('Doing', [{ id: 'p9x1bb', text: 'Call the vet' }]),
          column('Done', []),
        ],
        archive: [],
      },
    })], '2026-09-14')

    const stamped = /- \[ \] Order the timber \^([a-z0-9]{6})/.exec(pages[PAGE] ?? '')
    assert.ok(stamped !== null, `the line was not named: ${pages[PAGE]}`)
    const [file, text] = wrote[0] ?? []
    assert.equal(file, 'board')
    assert.ok(String(text).includes(`- Order the timber ^${stamped[1]}`), text)
  })

  test('and the page is written before the board, because the board is written in terms of it', async () => {
    const { store, wrote, pages } = storeWith({ page })
    await keepBoards(store, PAGE, [board({
      answer: {
        columns: [
          column('To do', [{ id: 'k4m2qa', text: 'Fix the gate' }, { index: 2, text: 'Order the timber' }]),
          column('Doing', [{ id: 'p9x1bb', text: 'Call the vet' }]),
          column('Done', []),
        ],
        archive: [],
      },
    })], '2026-09-14')
    // Both landed, and the name in the file is the name on the line.
    const onLine = /\^([a-z0-9]{6})/.exec(pages[PAGE] ?? '')?.[1]
    assert.ok(String(wrote[0]?.[1]).includes(`^${onLine}`))
  })

  // An arrangement holding a name that never reached a line is a board full
  // of cards pointing at nothing.
  test('and a page that cannot be written takes the board write with it', async () => {
    const { store, wrote, notices } = storeWith({ page, writes: false })
    await keepBoards(store, PAGE, [board({
      answer: {
        columns: [column('To do', [{ index: 2, text: 'Order the timber' }]), column('Done', [])],
        archive: [],
      },
    })], '2026-09-14')
    assert.deepEqual(wrote, [])
    assert.deepEqual(notices, ['Kanban: a card could not be named, so the board was left as it was.'])
  })

  // The answer is about a page that has moved under it, so the next draw asks
  // again against the page as it now is.
  test('and an index that is no longer a line is dropped without a word', async () => {
    const { store, wrote, notices } = storeWith({ page: '# Monday\n' })
    await keepBoards(store, PAGE, [board({
      answer: {
        columns: [column('To do', [{ index: 9, text: 'Gone' }]), column('Done', [])],
        archive: [],
      },
    })], '2026-09-14')
    assert.deepEqual(wrote, [])
    assert.deepEqual(notices, [])
  })
})

describe('a task that finished', () => {
  const page = `# Monday

- [x] Call the vet ^p9x1bb
`

  test('moves its card to the last column and is marked with the day', async () => {
    const { store, wrote } = storeWith({ page })
    await keepBoards(store, PAGE, [board({ answer: { columns: UNCHANGED, archive: [] } })], '2026-09-14')
    const [file, text] = wrote[0] ?? []
    assert.equal(file, 'board')
    // Where the line ended up rather than the blank lines around it: the
    // spacing is `mergeBoard`'s, and `board-file.test.js` is where it belongs.
    const line = String(text).indexOf('- Call the vet  done 2026-09-14 ^p9x1bb')
    assert.ok(line !== -1, text)
    assert.ok(line > String(text).indexOf('## Done'), text)
  })

  test('and the prose beside it keeps its place', async () => {
    const { store, wrote } = storeWith({ page })
    await keepBoards(store, PAGE, [board({ answer: { columns: UNCHANGED, archive: [] } })], '2026-09-14')
    assert.ok(String(wrote[0]?.[1]).includes('Waiting on the timber.'), wrote[0]?.[1])
  })

  test('a struck line is marked where it stands rather than moved', async () => {
    const { store, wrote } = storeWith({ page: '# Monday\n\n- [-] Call the vet ^p9x1bb\n' })
    await keepBoards(store, PAGE, [board({ answer: { columns: UNCHANGED, archive: [] } })], '2026-09-14')
    assert.ok(String(wrote[0]?.[1]).includes('- Call the vet  dropped 2026-09-14 ^p9x1bb'), wrote[0]?.[1])
    assert.ok(String(wrote[0]?.[1]).includes('## Doing'), 'still in Doing')
  })
})

describe('a card old enough to come off the board', () => {
  const ENDED = `# Board

## To do

- Fix the gate ^k4m2qa

## Done

- Call the vet  done 2026-09-01 ^p9x1bb
`

  /** What the plugin answers once a card has aged: named in `archive`, and
   *  left out of `columns`. */
  const aged = {
    columns: [column('To do', [{ id: 'k4m2qa', text: 'Fix the gate' }]), column('Done', [])],
    archive: ['p9x1bb'],
  }

  test('goes into the archive first, and off the board second', async () => {
    const { store, wrote } = storeWith({ board: ENDED })
    await keepBoards(store, PAGE, [board({ board: ENDED, answer: aged })], '2026-09-14')
    assert.deepEqual(wrote.map(([file]) => file), ['archive', 'board'])
    assert.ok(String(wrote[0]?.[1]).includes('- Call the vet  done 2026-09-01 ^p9x1bb'), wrote[0]?.[1])
    assert.ok(!String(wrote[1]?.[1]).includes('p9x1bb'), wrote[1]?.[1])
  })

  test('with the line the board had, not a line rewritten for the archive', async () => {
    const { store, wrote } = storeWith({ board: ENDED })
    await keepBoards(store, PAGE, [board({ board: ENDED, answer: aged })], '2026-09-14')
    assert.equal(wrote[0]?.[1], '# Archive\n\n- Call the vet  done 2026-09-01 ^p9x1bb\n')
  })

  test('and an archive nobody has read yet is not appended to', async () => {
    const { store, wrote } = storeWith({ board: ENDED, archive: null })
    await keepBoards(store, PAGE, [board({ board: ENDED, answer: aged })], '2026-09-14')
    assert.deepEqual(wrote, [])
  })

  // A card taken off the board is off it for good, so an archive that did not
  // land holds the board's write back rather than losing the task.
  test('and an archive that will not save leaves the card on the board', async () => {
    const { store, wrote } = storeWith({ board: ENDED, writes: false })
    await keepBoards(store, PAGE, [board({ board: ENDED, answer: aged })], '2026-09-14')
    assert.deepEqual(wrote, [])
  })

  test('a card nothing has finished is refused, and the board is written without it leaving', async () => {
    const { store, wrote, notices } = storeWith({ board: ENDED })
    await keepBoards(store, PAGE, [board({
      board: ENDED,
      answer: { columns: aged.columns, archive: ['k4m2qa'] },
    })], '2026-09-14')
    assert.deepEqual(notices, ['Kanban: the board asked to archive 1 card nothing has finished'])
    for (const [file] of wrote) assert.notEqual(file, 'archive')
  })
})

describe('a board file nothing can read', () => {
  const BROKEN = '- A card above every heading ^k4m2qa\n'

  test('is not written over, and the tab says so', async () => {
    const { store, wrote, notices } = storeWith({ board: BROKEN })
    await keepBoards(store, PAGE, [board({
      board: BROKEN,
      answer: { columns: [column('To do', [{ id: 'k4m2qa', text: 'Fix the gate' }])], archive: [] },
    })], '2026-09-14')
    assert.deepEqual(wrote, [])
    assert.deepEqual(notices, [
      "Kanban: this board's file cannot be read, so nothing was written to it.",
    ])
  })
})

describe('two boards', () => {
  test('are two files, and one that writes nothing does not stop the other', async () => {
    const { store, wrote } = storeWith({ page: '# Monday\n\n- [x] Call the vet ^p9x1bb\n' })
    await keepBoards(store, PAGE, [
      board({ plugin: 'quiet', tab: 'Quiet', answer: null }),
      board({ answer: { columns: UNCHANGED, archive: [] } }),
    ], '2026-09-14')
    assert.deepEqual(wrote.map(([file]) => file), ['board'])
  })
})
