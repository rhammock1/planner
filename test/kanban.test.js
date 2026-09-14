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
