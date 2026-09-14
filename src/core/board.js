// @ts-check

/**
 * `spread.board`: what a board is handed, and what the app believes of what
 * it hands back (spec §2.2-2.4).
 *
 * The board *file* - what `board.md` and `archive.md` look like, which the
 * app and the plugin both have to be able to read - is `boardFile.js`. This
 * is the slot, and it has the plain name for the reason every other slot
 * module does: `badges.js` is `item.badge` and `sections.js` is `page.note`,
 * so `board.js` is where somebody looks for `spread.board`.
 *
 * The grant is `item.badge`'s, one page wide: every line the parser
 * understood on the day being drawn, and never the vault. `state` comes with
 * it, which `item.badge` does not send, because a board's whole difficulty is
 * telling *done yesterday* from *deleted* and four states is what tells them
 * apart - a boolean collapses `migrated` into `open` and seeds a card from a
 * line that was carried away (spec §2.3).
 *
 * `id` is null far more often than not, and asking never changes that: a name
 * is stamped when a line becomes a card, never because a question was put
 * about it. The plugin asks for one by sending the line's `index` back.
 *
 * Pure. It never sees the DOM and never writes a file: it returns what the
 * caller may act on, and the caller does the acting.
 */

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./model.js').ItemState} ItemState */
/** @typedef {{index: number, id: string|null, text: string, state: ItemState}} BoardLine */
/** @typedef {{id: string|null, index: number|null, text: string, ended: 'done'|'dropped'|null}} Card */
/** @typedef {{name: string, cards: Card[]}} Column */
/** @typedef {{columns: Column[], archive: string[]}} Answer */

import { isValidId } from './ids.js'

/** The two files a board plugin keeps in its folder of the vault, without the
 *  `.md` - which is what `folders.rs` adds, because the extension is the app's
 *  and not part of either name.
 *
 *  Named here rather than in `boardFile.js` because these are what the *app*
 *  reads and writes; the grammar of what is inside them is that module's. A
 *  plugin never sees either name: it is handed the text and hands back a
 *  board (spec §2.5). */
export const BOARD = 'board'
export const ARCHIVE = 'archive'

/** As long as a line of the day page may be, and for the same reason: a card
 *  holds a task's words, and a task's words are one line. */
const LONGEST = 200

/** A column heading is a word or two above a stack of cards. Longer than this
 *  and the heading is wider than the column under it. */
const LONGEST_NAME = 40

/**
 * Every line a board is shown, in page order.
 *
 * @param {Document|null} doc
 * @returns {BoardLine[]}
 */
export function boardLinesOf(doc) {
  if (doc === null) return []
  /** @type {BoardLine[]} */
  const lines = []
  doc.nodes.forEach((node, index) => {
    if (node.kind !== 'item') return
    lines.push({ index, id: node.id, text: node.text, state: node.state })
  })
  return lines
}

/**
 * What makes an old answer wrong.
 *
 * The lines sent and the file, because the answer is a function of both: a
 * board is rebuilt from `board.md` every time it is asked, so a card dragged
 * into another column has to be a different question or the drag is drawn
 * once and forgotten. A keystroke in the daily note is not in either, which
 * is the property `badgeKey` has and this needs for the same reason.
 *
 * `state` is in the key where `badgeKey` has no such field: ticking a line is
 * the gesture that ends a card, and a key that missed it would answer a tick
 * with the board from before it.
 *
 * @param {string} date  `YYYY-MM-DD`
 * @param {BoardLine[]} lines
 * @param {string} board  the file as it stands, `''` when there is none
 * @returns {string}
 */
export function boardKey(date, lines, board) {
  let hash = 0x811c9dc5
  /** @param {string} text */
  const eat = (text) => {
    for (const char of text) {
      hash ^= char.codePointAt(0) ?? 0
      // FNV-1a, in the arithmetic JavaScript actually has. Not a security
      // property: two boards hashing the same would re-use an answer, which
      // costs one stale draw until the next edit.
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  for (const line of lines) eat(`${line.index}\t${line.text}\t${line.id ?? ''}\t${line.state}\n`)
  // Written as an escape rather than typed: the byte may go through the hash
  // and may not sit in this file, which `test/repo.test.js` enforces over
  // every tracked text file.
  eat(`\u0000${board}`)
  return `${date}:${lines.length}:${board.length}:${hash.toString(36)}`
}

/**
 * The board a plugin answered with, believed one field at a time.
 *
 * Everything here arrived from somebody else's code and the app is about to
 * write a file from it, so nothing is taken on trust and anything that does
 * not survive is dropped and counted. A whole answer that is not a board at
 * all returns null, and the tab draws the file as it stands - which is a
 * thing it can always do, because the file is the truth about the board and
 * the plugin is only ever proposing a rearrangement of it.
 *
 * What is *not* checked here, on purpose: whether a card's id is one the file
 * holds. An id the file has never seen is a card to create - a line that
 * already had a name before any board existed is exactly that - and a card
 * the file holds that the answer leaves out is kept where the file has it.
 * An omission is not a deletion, and that is the merge's rule to keep.
 *
 * @param {unknown} value  what the plugin returned
 * @param {BoardLine[]} lines  exactly what was sent, which is what an `index`
 *   may name
 * @returns {{answer: Answer|null, notices: string[]}}
 */
export function readBoard(value, lines) {
  /** @type {string[]} */
  const notices = []
  if (value === null || value === undefined) return { answer: null, notices }
  if (typeof value !== 'object' || Array.isArray(value)) {
    notices.push('the board returned something that is not a board')
    return { answer: null, notices }
  }

  const fields = /** @type {Record<string, unknown>} */ (value)
  const raw = fields['columns']
  if (!Array.isArray(raw)) {
    notices.push('the board returned no columns')
    return { answer: null, notices }
  }

  const sent = new Map(lines.map((line) => [line.index, line]))
  /** Every id and index already spoken for, so one line cannot become two
   *  cards and one card cannot sit in two columns. The board is a place a
   *  task *is*, and a task in two places is a board that cannot be dragged. */
  const taken = new Set()
  /** @type {Column[]} */
  const columns = []
  /** @type {Set<string>} */
  const named = new Set()
  let dropped = 0

  for (const one of raw) {
    const read = readColumn(one, sent, taken, named)
    dropped += read.dropped
    const column = read.column
    if (column === null) {
      dropped += 1
      continue
    }
    named.add(column.name)
    columns.push(column)
  }

  if (columns.length === 0) {
    notices.push('the board returned no columns this app could read')
    return { answer: null, notices }
  }

  /** @type {string[]} */
  const archive = []
  const asked = fields['archive']
  if (Array.isArray(asked)) {
    for (const id of asked) {
      if (typeof id !== 'string' || !isValidId(id) || archive.includes(id)) {
        dropped += 1
        continue
      }
      archive.push(id)
    }
  } else if (asked !== null && asked !== undefined) {
    notices.push('the board asked to archive something that is not a list')
  }

  // Counted, not listed. One malformed card is worth saying; forty would be
  // forty lines of notice over a board of three.
  if (dropped > 0) {
    notices.push(`the board sent ${dropped} ${dropped === 1 ? 'thing' : 'things'} this app could not read`)
  }

  return { answer: { columns, archive }, notices }
}

/**
 * A column, and how many of its cards did not survive.
 *
 * The count comes back rather than being kept here, because what a person is
 * told is one sentence about the whole answer: a board that sends forty bad
 * cards has one thing wrong with it, not forty.
 *
 * @param {unknown} raw
 * @param {Map<number, BoardLine>} sent
 * @param {Set<string|number>} taken
 * @param {Set<string>} named  the columns already kept, by name
 * @returns {{column: Column|null, dropped: number}}
 */
function readColumn(raw, sent, taken, named) {
  const none = { column: null, dropped: 0 }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return none
  const fields = /** @type {Record<string, unknown>} */ (raw)

  const name = flatten(fields['name'], LONGEST_NAME)
  // A column with no name is a heading the file cannot write and a tab cannot
  // label. Unlike a card, there is nothing to fall back to.
  if (name === '') return none
  // Two columns with one name cannot be told apart by the name, which is the
  // same refusal `parseBoard` makes about the file for the same reason.
  //
  // Refused here, before the cards are read, so a column that is going to be
  // dropped does not first claim its cards' names: a card in the duplicate
  // would otherwise take a name the *kept* column later wanted, and vanish
  // from both.
  if (named.has(name)) return none

  const cards = fields['cards']
  // An empty column is an ordinary column - a board's first draw is three of
  // them - so a missing list is the wrong shape and an empty one is not.
  if (!Array.isArray(cards)) return none

  /** @type {Card[]} */
  const held = []
  let dropped = 0
  for (const one of cards) {
    const card = readCard(one, sent, taken)
    if (card === null) {
      dropped += 1
      continue
    }
    held.push(card)
  }
  return { column: { name, cards: held }, dropped }
}

/**
 * @param {unknown} raw
 * @param {Map<number, BoardLine>} sent
 * @param {Set<string|number>} taken
 * @returns {Card|null}
 */
function readCard(raw, sent, taken) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = /** @type {Record<string, unknown>} */ (raw)

  const asId = fields['id']
  const asIndex = fields['index']
  // Normalised to null *before* the test below, so "exactly one" is a test on
  // values and not on which keys were sent. A plugin that fills in both keys
  // and leaves one null is sending a perfectly good card, and the obvious
  // later tidy-up - testing `'id' in card` instead - would silently drop
  // every card such a plugin sends.
  const id = typeof asId === 'string' && isValidId(asId) ? asId : null
  const line = typeof asIndex === 'number' ? sent.get(asIndex) ?? null : null

  // Exactly one. Both set is a card asking to be two things, and neither is a
  // card naming nothing - the app would have to guess which task it is, and
  // the guess would be written to a file.
  if ((id === null) === (line === null)) return null

  // A line that was carried to another day is not a task this page still
  // holds: its twin on the later day is the live one, and carrying is what
  // took the name off this copy in the first place (`carry.js`, move rather
  // than copy). Stamping it would mint a *second* name for one task, on a
  // page the person has already moved past - so the app refuses, whoever
  // asked. The other three states are the plugin's to judge.
  if (line !== null && line.state === 'migrated') return null

  // A line that already has a name is named, whoever asked for it how.
  // Stamping is idempotent, but reaching a named line through `index` would
  // put one task on the board twice under two spellings.
  const named = id ?? line?.id ?? null
  /** @type {string|number} */
  const key = named ?? /** @type {number} */ (line?.index)
  if (taken.has(key)) return null
  taken.add(key)

  const text = flatten(fields['text'], LONGEST) || line?.text || ''
  // A card with no words is a line nobody can read and a file that says
  // nothing. There is no sensible fallback left by this point.
  if (text === '') return null

  const ended = fields['ended']
  return {
    id: named,
    index: named === null && line !== null ? line.index : null,
    text,
    ended: ended === 'done' || ended === 'dropped' ? ended : null,
  }
}

/**
 * One line, whatever arrived.
 *
 * Every run of whitespace becomes one space, which is the check that matters
 * rather than a tidiness: a card's text is written into a line of `board.md`,
 * so a newline in it would write a second line and a second line is a card
 * the file did not agree to.
 *
 * @param {unknown} raw
 * @param {number} longest
 * @returns {string}
 */
function flatten(raw, longest) {
  if (typeof raw !== 'string') return ''
  const line = raw.replace(/\s+/gu, ' ').trim()
  return line.length <= longest ? line : `${line.slice(0, longest - 1)}…`
}
