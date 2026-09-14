// @ts-check

/**
 * The two files `plugins/kanban` keeps in the folder it owns, `<vault>/
 * kanban/` (spec §2.5): `board.md`, which is the board, and `archive.md`,
 * which is where an ended card goes.
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

/** The archive a vault gets on its first ending. */
const ARCHIVE_FRESH = '# Archive\n\n'

/**
 * The archive with some cards added to the end of it.
 *
 * Append-only, newest last, never read back (design §3.2). Every write is a
 * prefix of the next, which is what makes losing the record impossible: a
 * line that went in is never a line a later write moves. The lines are the
 * ones `board.md` held, unchanged, so archiving is a move rather than a
 * re-rendering, and the day page still holds the tick that decided it.
 *
 * Archiving nothing writes nothing - not even a heading, because a vault
 * that has never finished a card has nothing to say in a file (design §9:
 * created on first write, never on first read).
 *
 * @param {string} text  the archive as it stands, `''` when there is none
 * @param {Card[]} cards
 * @returns {string}
 */
function appendArchive(text, cards) {
  if (cards.length === 0) return text
  const held = text.trim() === '' ? ARCHIVE_FRESH : text.endsWith('\n') ? text : `${text}\n`
  return `${held}${cards.map(lineOf).join('\n')}\n`
}

/**
 * @typedef {object} Placed
 * @property {string} id
 * @property {string} text
 * @property {'done'|'dropped'|null} ended
 */

/**
 * @typedef {object} PlacedColumn
 * @property {string} name
 * @property {Placed[]} cards
 */

/**
 * The board file with an answer's arrangement written onto it.
 *
 * This is the write the app makes once a board plugin has answered and every
 * card it named has a name (design §9). It is the one place the file's two
 * promises have to hold at the same time:
 *
 *   - **An omission is not a deletion.** A card the file holds that the
 *     answer never mentions is left exactly where the file has it. A plugin
 *     that answered with half a board, or answered late, or was switched off
 *     between the question and the write, cannot empty the file - so the
 *     worst a broken plugin does is fail to rearrange.
 *   - **A board nobody rearranged comes back byte for byte.** A card whose
 *     words, column and ending are all what they were is written back from
 *     the `raw` line it was read from, never re-rendered, so an unchanged
 *     file is not rewritten and a hand-made line keeps the spaces in it.
 *
 * The arrangement is applied by filling slots rather than by rebuilding a
 * column: every card the answer names anywhere leaves its old line vacant,
 * the vacancies in each column are filled in the answer's order, and
 * everything else - prose, blank lines, a card nobody mentioned - keeps the
 * place it had. That is what stops a note somebody wrote between two cards
 * from migrating to the top of the column the first time anything moves.
 *
 * A card that is ending now is stamped with `today`; a card that ended on
 * some earlier day keeps the day it has. The marker is the only clock the
 * ageing rule has, so rewriting it on every draw would mean a finished card
 * never got old enough to leave.
 *
 * `leaving` is the one thing that does take a card off the board, and it is
 * not an omission - it is the app saying it has already written that card's
 * line into `archive.md`. The two have to be different: the archive is
 * append-only, so a card left on the board after being archived is archived
 * again on the next draw, and again after that, and no later write can undo
 * it. An id in `leaving` that the file does not hold is a no-op. An id in
 * both `leaving` and `columns` leaves, because by the time the app names one
 * there the line is already in the archive, and a card drawn for one more
 * draw is the smaller wrong answer than a card recorded twice for ever.
 *
 * @param {string} text  the board as it stands, `''` when there is none
 * @param {PlacedColumn[]} columns  the arrangement, cards already named
 * @param {string} today  `YYYY-MM-DD`, for a card that is ending now
 * @param {Iterable<string>} [leaving]  ids already written into `archive.md`
 * @returns {string|null}  null when the file cannot be read, so it is left alone
 */
function mergeBoard(text, columns, today, leaving = []) {
  const { board } = parseBoard(text.trim() === '' ? FRESH : text)
  if (board === null) return null

  /** Every card the file holds, by name, first one winning - the same rule
   *  the board is drawn under, so a file with one id twice merges the way it
   *  reads. @type {Map<string, {card: Card, entry: Entry}>} */
  const before = new Map()
  for (const column of board.columns) {
    for (const entry of column.entries) {
      if (entry.kind === 'card' && !before.has(entry.card.id)) {
        before.set(entry.card.id, { card: entry.card, entry })
      }
    }
  }

  const gone = new Set(leaving)

  /** @type {Map<string, Placed[]>} */
  const wanted = new Map()
  /** @type {Set<string>} */
  const named = new Set()
  for (const column of columns) {
    if (!wanted.has(column.name)) wanted.set(column.name, column.cards.filter((card) => !gone.has(card.id)))
    for (const card of column.cards) if (!gone.has(card.id)) named.add(card.id)
  }

  /**
   * One card as a line, reusing the one it came from when nothing about it
   * changed.
   *
   * @param {Placed} card
   * @returns {Entry}
   */
  function entryFor(card) {
    const held = before.get(card.id)?.card ?? null
    const endedOn = card.ended === null
      ? null
      : held !== null && held.ended === card.ended && held.endedOn !== null
        ? held.endedOn
        : today
    const was = before.get(card.id)?.entry
    if (was !== undefined && held !== null
      && held.text === card.text && held.ended === card.ended && held.endedOn === endedOn) {
      return was
    }
    const made = { id: card.id, text: card.text, ended: card.ended, endedOn }
    return { kind: 'card', card: made, raw: lineOf(made) }
  }

  /** @type {Column[]} */
  const merged = board.columns.map((column) => {
    // A column the answer never mentioned is not a column the answer
    // emptied: it has no cards of its own to place, so every card it holds
    // stays unless it was placed somewhere else or is leaving.
    const queue = [...(wanted.get(column.name) ?? [])]
    /** @type {Entry[]} */
    const entries = []
    for (const entry of column.entries) {
      if (entry.kind === 'card' && gone.has(entry.card.id)) {
        // Not a vacancy - a line going away. Its place closes up rather than
        // taking the next card, because the card that was here is the one
        // already written into `archive.md`.
        continue
      }
      if (entry.kind === 'card' && named.has(entry.card.id)) {
        // A vacancy. It takes the next card the answer put in this column,
        // and closes if the answer has none left - which is how a card named
        // in some other column stops being drawn in this one too.
        const next = queue.shift()
        if (next !== undefined) entries.push(entryFor(next))
        continue
      }
      entries.push(entry)
    }

    // Cards the column did not have room for go after its last card, rather
    // than after whatever blank line ends the column.
    let at = entries.length
    for (let n = entries.length - 1; n >= 0; n -= 1) {
      if (entries[n]?.kind === 'card') { at = n + 1; break }
      if (n === 0) at = 0
    }
    entries.splice(at, 0, ...queue.map(entryFor))
    return { ...column, entries }
  })

  const have = new Set(board.columns.map((column) => column.name))
  for (const column of columns) {
    if (have.has(column.name)) continue
    have.add(column.name)
    merged.push({
      name: column.name,
      heading: `## ${column.name}`,
      entries: column.cards.map(entryFor),
    })
  }

  return serialiseBoard({ preamble: board.preamble, columns: merged })
}

export { CARD, HEADING, FRESH, cardOf, lineOf, parseBoard, serialiseBoard, appendArchive, mergeBoard }
