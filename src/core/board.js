// @ts-check

/**
 * The two files `plugins/kanban` keeps at the vault root: `board.md`, which
 * is the board, and `archive.md`, which is where an ended card goes.
 *
 * Here rather than in the plugin because the app needs the same grammar. It
 * writes `board.md` when a card is dropped in another column, when a line on
 * a day page is ticked, and when a card is old enough to age out; and it
 * draws the file as it stands, unseeded, on any day the plugin is slow or
 * switched off. A format only one side could read would make the second of
 * those impossible.
 *
 * The plugin cannot import this module - `tools/update` installs a plugin by
 * copying its folder alone, and `plugin://<name>/` refuses any path climbing
 * out of it - so `plugins/kanban/index.js` carries verbatim copies of the
 * parsing half, and `test/plugin-parity.test.js` holds them against these.
 *
 * Nothing here writes a file and nothing here mints an id. An id is core's
 * token, stamped by the app on a line that needs one (design §4.1).
 */

/**
 * @typedef {object} Card
 * @property {string} id  six lowercase alphanumerics, the task's durable id
 * @property {string} text  the line as it reads, without its tokens
 * @property {'done'|'dropped'|null} ended  how it finished, or null in flight
 * @property {string|null} endedOn  `YYYY-MM-DD`, the day the app saw it end
 */

/**
 * One card, as `board.md` and `archive.md` both hold it.
 *
 * The id is last, which is where a day page's line carries it too (design
 * §4.2), and an ending marker sits between the text and the id behind two
 * spaces - the shape the archive example in the design already had. Two
 * spaces rather than one so an ordinary line that happens to say "done" is
 * still an ordinary line.
 */
const CARD = /^- (.*?)(?:  (done|dropped) (\d{4}-\d{2}-\d{2}))? \^([a-z0-9]{6})$/

/**
 * A card, or null for a line that is not one.
 *
 * A `-` line with no id is *not* a card: the board is not a second place to
 * write tasks (design §1), so a line you typed by hand is text the file keeps
 * (`parseBoard`), not a card with no id that nothing could drag.
 *
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

/**
 * The line a card writes.
 *
 * Runs of spaces in the text are collapsed, which is the one thing this does
 * not round-trip and the one thing it must: a card whose own words read
 * `  done 2026-01-01` would otherwise write a line that reads back as an
 * ended card. It costs nothing in practice, because this is only reached for
 * a line the app is rewriting anyway - `serialiseBoard` writes back the line
 * a card was read from, untouched, for every card it did not change.
 *
 * @param {Card} card
 * @returns {string}
 */
function lineOf(card) {
  const text = card.text.replace(/ {2,}/gu, ' ')
  const ending = card.ended === null ? '' : `  ${card.ended} ${card.endedOn}`
  return `- ${text}${ending} ^${card.id}`
}

/**
 * @typedef {{kind: 'card', card: Card, raw: string}
 *   | {kind: 'text', line: string}} Entry
 */

/**
 * @typedef {object} Column
 * @property {string} name  the heading's words, trimmed
 * @property {string} heading  the heading line exactly as it was written
 * @property {Entry[]} entries  cards and the text between them, in file order
 */

/**
 * @typedef {object} Board
 * @property {string[]} preamble  every line above the first heading
 * @property {Column[]} columns
 */

/** A column. The last one is the done column, by position and not by name
 *  (design §3.1): you may call it `Shipped`, and you may not put a column
 *  after it that means something else. */
const HEADING = /^##\s+(.+?)\s*$/

/** The board a vault gets on its first draw. The names are only defaults -
 *  the file is the truth about them from that moment on (design §3.1). */
const FRESH = '# Board\n\n## To do\n\n## Doing\n\n## Done\n'

/**
 * A board file, or the reason it cannot be written back.
 *
 * Never rejects a file for being untidy: anything that is not a heading and
 * not a card is kept where it is and written back untouched, the way
 * `src/core/parse.js` keeps an Opaque node. Two things are refused, and both
 * for the same reason - a write would have to guess. A card above the first
 * heading is in no column, and two columns with one name cannot be told apart
 * by the name an answer would use. Neither overwrites anything: the tab says
 * so and offers to open the file (design §9).
 *
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
 * The file a board writes.
 *
 * A card writes back the line it was read from rather than a line rebuilt
 * from its parts, so a file nobody changed comes back byte for byte - the
 * contract `tools/dump.js --check` holds day pages to, applied here. A card
 * the app *did* change carries a `raw` rebuilt by `lineOf` at the moment of
 * the change, so there is one rule rather than a flag.
 *
 * @param {Board} board
 * @returns {string}
 */
function serialiseBoard(board) {
  /** @type {string[]} */
  const lines = [...board.preamble]
  for (const column of board.columns) {
    lines.push(column.heading)
    for (const entry of column.entries) lines.push(entry.kind === 'card' ? entry.raw : entry.line)
  }
  return lines.join('\n')
}

export { CARD, HEADING, FRESH, cardOf, lineOf, parseBoard, serialiseBoard }
