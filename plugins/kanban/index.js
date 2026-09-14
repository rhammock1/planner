// @ts-check

/**
 * A board of what is started, going and finished (design §1).
 *
 * The day page stays one list, today, written the way you would write it in
 * an assignment notebook. This is the same lines arranged by how far along
 * they are, and it is the only place that arrangement exists. Every card
 * began life as a line on a day page; nothing is written here first.
 *
 * What this plugin does is small and exact, and it got small on purpose. A
 * card is keyed on the line's durable id, which the app stamps and owns, so
 * matching is a lookup rather than a guess about words - and what is left
 * here is three rules:
 *
 *   - **Seed.** Every open line on today's page whose id has no card gets
 *     one, at the bottom of the first column. A line with no id yet is named
 *     by its `index` instead, which asks the app to stamp it. A plugin never
 *     mints an id and answering a question never writes a file.
 *   - **Keep.** Every card the file holds is answered, in the column and the
 *     order the file has it, reading the way its line reads today. A card
 *     whose task is nowhere on today's page keeps the text the file has:
 *     absence is not a decision.
 *   - **Age.** A card the app has marked `done` or `dropped` is named in
 *     `archive` once `hide_done_after` days have passed.
 *
 * It never decides that a task finished - a tick is a decision recorded on
 * the day page and the app is what notices it (design §6). It never writes,
 * and it never sees a pointer event: a drop is the app's write to `board.md`,
 * which is what lets a drag survive a plugin that is slow or switched off.
 *
 * `CARD`, `HEADING`, `FRESH`, `cardOf` and `parseBoard` below are copied
 * verbatim from `src/core/board.js`. They cannot be imported: `tools/update`
 * installs a plugin by copying its folder alone and `plugin://<name>/`
 * refuses any path that climbs out of it. `test/plugin-parity.test.js` holds
 * the copies against the original so drift is caught here rather than on
 * somebody's day - a board that parsed its own file differently than the app
 * writes it is the worst bug this plugin could have.
 */

/**
 * @typedef {object} Card
 * @property {string} id
 * @property {string} text
 * @property {'done'|'dropped'|null} ended
 * @property {string|null} endedOn
 */

/**
 * @typedef {{kind: 'card', card: Card, raw: string}
 *   | {kind: 'text', line: string}} Entry
 */

/**
 * @typedef {object} Column
 * @property {string} name
 * @property {string} heading
 * @property {Entry[]} entries
 */

/**
 * @typedef {object} Board
 * @property {string[]} preamble
 * @property {Column[]} columns
 */

const CARD = /^- (.*?)(?:  (done|dropped) (\d{4}-\d{2}-\d{2}))? \^([a-z0-9]{6})$/

/**
 * @param {string} line
 * @returns {Card|null}
 */
function cardOf(line) {
  const found = CARD.exec(line)
  if (found === null) return null
  const ended = found[2]
  return {
    id: found[4] ?? '',
    text: found[1] ?? '',
    ended: ended === 'done' || ended === 'dropped' ? ended : null,
    endedOn: found[3] ?? null,
  }
}

const HEADING = /^##\s+(.+?)\s*$/

const FRESH = '# Board\n\n## To do\n\n## Doing\n\n## Done\n'

/**
 * @param {string} text
 * @returns {{board: Board|null, problem: string|null}}
 */
function parseBoard(text) {
  /** @type {string[]} */
  const preamble = []
  /** @type {Column[]} */
  const columns = []
  /** @type {Set<string>} */
  const named = new Set()

  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading !== null) {
      const name = heading[1] ?? ''
      if (named.has(name)) return { board: null, problem: `two columns are named ${name}` }
      named.add(name)
      columns.push({ name, heading: line, entries: [] })
      continue
    }

    const card = cardOf(line)
    const column = columns[columns.length - 1]
    if (column === undefined) {
      if (card !== null) return { board: null, problem: 'a card sits above the first column' }
      preamble.push(line)
      continue
    }
    column.entries.push(card === null ? { kind: 'text', line } : { kind: 'card', card, raw: line })
  }

  return { board: { preamble, columns }, problem: null }
}

/**
 * The board as the file holds it, or null when the file cannot be read.
 *
 * A board that is not there yet is the three default columns, which is the
 * only moment those names come from anywhere but the file.
 *
 * @param {string} text
 * @returns {Board|null}
 */
function boardFrom(text) {
  return parseBoard(text.trim() === '' ? FRESH : text).board
}

/**
 * Every card the file holds, first one wins.
 *
 * One task is on the board once (design §9). A second line with the same id
 * is dropped rather than drawn: a board showing one task twice is a board you
 * stop trusting, and the file is yours to fix.
 *
 * @param {Board} board
 * @returns {Map<string, Card>}
 */
function heldBy(board) {
  /** @type {Map<string, Card>} */
  const held = new Map()
  for (const column of board.columns) {
    for (const entry of column.entries) {
      if (entry.kind === 'card' && !held.has(entry.card.id)) held.set(entry.card.id, entry.card)
    }
  }
  return held
}

planner.on('spread.board', ({ items, board }) => {
  const parsed = boardFrom(board)
  // The app parsed the same file and says so itself; there is nothing useful
  // to add, and an answer over a guess would become a write over a file
  // nobody could read (design §9).
  if (parsed === null) return { columns: [], archive: [] }

  const held = heldBy(parsed)

  /** @type {Map<string, Planner.BoardItem>} */
  const byId = new Map()
  for (const item of items) {
    if (item.id !== null) byId.set(item.id, item)
  }

  /** @type {Planner.BoardColumn[]} */
  const columns = parsed.columns.map((column) => ({
    name: column.name,
    cards: column.entries.flatMap((entry) => {
      if (entry.kind !== 'card') return []
      // `heldBy` kept the first card for each id, so any later entry with
      // that id is not the one it held.
      if (held.get(entry.card.id) !== entry.card) return []
      // The line's words today, when there is a line; otherwise the words the
      // file has. Editing a line changes the card, and a card whose task is
      // not on this page keeps what it said.
      const text = byId.get(entry.card.id)?.text ?? entry.card.text
      return [{ id: entry.card.id, index: null, text, ended: entry.card.ended }]
    }),
  }))

  return { columns, archive: [] }
})
