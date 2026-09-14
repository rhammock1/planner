// @ts-check

/**
 * `plugins/kanban`, driven through the handler it actually registers.
 *
 * A plugin module runs `planner.on(...)` against a global that only exists
 * inside the app, and exports nothing, so there is no way to import one and
 * call a piece of it. Standing the global up here and catching the handler
 * tests the artifact that ships rather than a copy of its arithmetic - which
 * matters most for the thing this plugin is: a rule about what to answer.
 *
 * The import is by URL rather than by specifier so the node type program does
 * not follow it into `plugins/`, which is checked in the web program against
 * `plugins/planner.d.ts` and would not compile here.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

/** @type {Record<string, Function>} */
const handlers = {}

/** @type {Record<string, string|number|boolean>} */
let settings = {}

Object.assign(globalThis, {
  planner: {
    on: (/** @type {string} */ slot, /** @type {Function} */ handler) => { handlers[slot] = handler },
    get settings() { return settings },
  },
})

await import(new URL('../plugins/kanban/index.js', import.meta.url).href)

/**
 * The plugin's answer to one question.
 *
 * @param {object} question
 * @returns {Promise<any>}
 */
async function ask(question) {
  const handler = handlers['spread.board']
  assert.ok(handler !== undefined, 'the plugin registered no spread.board handler')
  return await handler({
    now: { date: '2026-09-14', time: '09:00' },
    date: '2026-09-14',
    items: [],
    board: '',
    ...question,
  })
}

const BOARD = [
  '# Board',
  '',
  '## To do',
  '- Chase the printer firmware sign-off ^b40e17',
  '',
  '## Doing',
  '- Pair with Dana on the offline queue ^a3f9k2',
  '',
  '## Done',
  '',
].join('\n')

test('the answer is the file, column for column and card for card', async () => {
  const answer = await ask({ board: BOARD })
  assert.deepEqual(answer.columns.map((/** @type {any} */ column) => column.name), ['To do', 'Doing', 'Done'])
  assert.deepEqual(answer.columns[1].cards, [
    { id: 'a3f9k2', index: null, text: 'Pair with Dana on the offline queue', ended: null },
  ])
  assert.deepEqual(answer.archive, [])
})

test('a board that is not there yet is the three default columns', async () => {
  const answer = await ask({ board: '' })
  assert.deepEqual(answer.columns.map((/** @type {any} */ column) => column.name), ['To do', 'Doing', 'Done'])
})

test('a card follows its id when the line changes its words', async () => {
  // The whole of what ids buy (design §4.3). The card stays in Doing and
  // reads the way the line reads now.
  const answer = await ask({
    board: BOARD,
    items: [{ index: 0, id: 'a3f9k2', text: 'Pair with Dana on the offline queue RFC', done: false }],
  })
  assert.deepEqual(answer.columns[1].cards, [
    { id: 'a3f9k2', index: null, text: 'Pair with Dana on the offline queue RFC', ended: null },
  ])
})

test('a card whose task is nowhere on the page is kept where it is', async () => {
  // Absence is not a decision (design §2). It keeps the text the file has.
  const answer = await ask({ board: BOARD, items: [] })
  assert.equal(answer.columns[0].cards[0].text, 'Chase the printer firmware sign-off')
})

test('one id twice in the file is one card', async () => {
  const twice = '## To do\n- A ^a3f9k2\n\n## Doing\n- A again ^a3f9k2\n'
  const answer = await ask({ board: twice })
  assert.deepEqual(answer.columns[0].cards.map((/** @type {any} */ card) => card.id), ['a3f9k2'])
  assert.deepEqual(answer.columns[1].cards, [])
})

test('a board that cannot be written back is answered with nothing', async () => {
  // The app parsed the same file and says so itself; an answer over a guess
  // would be a write over a file nobody could read (design §9).
  const answer = await ask({ board: '# Board\n- Stray ^a1b2c3\n\n## To do\n' })
  assert.deepEqual(answer, { columns: [], archive: [] })
})

test('an open line with no card is appended to the first column', async () => {
  const answer = await ask({
    board: BOARD,
    items: [{ index: 0, id: 'c1d2e3', text: 'Read the offline queue RFC', done: false }],
  })
  assert.deepEqual(answer.columns[0].cards, [
    { id: 'b40e17', index: null, text: 'Chase the printer firmware sign-off', ended: null },
    { id: 'c1d2e3', index: null, text: 'Read the offline queue RFC', ended: null },
  ])
})

test('an open line with no id yet is named by its index, for the app to stamp', async () => {
  // A plugin never mints an id (design §4.1, §5). Naming the line is how it
  // asks for one, and the app is what writes it.
  const answer = await ask({
    board: BOARD,
    items: [{ index: 3, id: null, text: 'Book the rehearsal room', done: false }],
  })
  assert.deepEqual(answer.columns[0].cards[1], {
    id: null,
    index: 3,
    text: 'Book the rehearsal room',
    ended: null,
  })
})

test('a line that already has a card does not move', async () => {
  // Tomorrow's board is today's board (design §2). A line still open in
  // Doing stays in Doing rather than being seeded again into To do.
  const answer = await ask({
    board: BOARD,
    items: [{ index: 0, id: 'a3f9k2', text: 'Pair with Dana on the offline queue', done: false }],
  })
  assert.deepEqual(answer.columns[0].cards.map((/** @type {any} */ card) => card.id), ['b40e17'])
  assert.deepEqual(answer.columns[1].cards.map((/** @type {any} */ card) => card.id), ['a3f9k2'])
})

test('a ticked line is not seeded', async () => {
  // It is a decision that was already made; seeding it would put a finished
  // task at the bottom of To do.
  const answer = await ask({
    board: BOARD,
    items: [{ index: 0, id: 'c1d2e3', text: 'Read the offline queue RFC', done: true }],
  })
  assert.deepEqual(answer.columns[0].cards.map((/** @type {any} */ card) => card.id), ['b40e17'])
})

test('lines are seeded in the order the page has them', async () => {
  const answer = await ask({
    board: BOARD,
    items: [
      { index: 0, id: null, text: 'First', done: false },
      { index: 1, id: 'c1d2e3', text: 'Second', done: false },
      { index: 2, id: null, text: 'Third', done: false },
    ],
  })
  assert.deepEqual(answer.columns[0].cards.map((/** @type {any} */ card) => card.text), [
    'Chase the printer firmware sign-off',
    'First',
    'Second',
    'Third',
  ])
})

test('a board with no columns at all seeds nothing and loses nothing', async () => {
  // There is no first column to append to. The lines keep their ids and the
  // next draw of a file with a column in it seeds them.
  const answer = await ask({
    board: '# Board\n\njust prose\n',
    items: [{ index: 0, id: 'c1d2e3', text: 'Read the offline queue RFC', done: false }],
  })
  assert.deepEqual(answer.columns, [])
})

const ENDED = [
  '## To do',
  '',
  '## Done',
  '- Ticked a week ago  done 2026-09-07 ^d4e5f6',
  '- Ticked today  done 2026-09-14 ^a1b2c3',
  '- Struck out yesterday  dropped 2026-09-13 ^b40e17',
  '',
].join('\n')

test('an ended card ages out on the day hide_done_after names, and not before', async () => {
  settings = { hide_done_after: 7 }
  const answer = await ask({ board: ENDED })
  assert.deepEqual(answer.archive, ['d4e5f6'])
  settings = {}
})

test('an aged-out card is not drawn any more', async () => {
  settings = { hide_done_after: 7 }
  const answer = await ask({ board: ENDED })
  assert.deepEqual(answer.columns[1].cards.map((/** @type {any} */ card) => card.id), ['a1b2c3', 'b40e17'])
  settings = {}
})

test('a card still in flight never ages out', async () => {
  settings = { hide_done_after: 0 }
  const answer = await ask({ board: BOARD })
  assert.deepEqual(answer.archive, [])
  settings = {}
})

test('hide_done_after of zero archives on the next draw', async () => {
  settings = { hide_done_after: 0 }
  const answer = await ask({ board: ENDED })
  assert.deepEqual(answer.archive, ['d4e5f6', 'a1b2c3', 'b40e17'])
  settings = {}
})

test('an unset or nonsense setting is seven days', async () => {
  for (const held of [{}, { hide_done_after: -1 }, { hide_done_after: 'soon' }]) {
    settings = /** @type {any} */ (held)
    const answer = await ask({ board: ENDED })
    assert.deepEqual(answer.archive, ['d4e5f6'], `${JSON.stringify(held)} did not fall back to seven`)
  }
  settings = {}
})

test('an ended card carries its ending, so the app can draw it as finished', async () => {
  settings = { hide_done_after: 30 }
  const answer = await ask({ board: ENDED })
  assert.deepEqual(answer.columns[1].cards.map((/** @type {any} */ card) => card.ended), ['done', 'done', 'dropped'])
  settings = {}
})
