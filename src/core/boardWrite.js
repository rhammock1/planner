// @ts-check

/**
 * What the app writes once a board has answered (kanban design §6, §9).
 *
 * `board.js` is the question and what the app believes of the reply;
 * `boardFile.js` is the grammar of the two files. This is the step between
 * them, and it exists because a board plugin is not allowed to know two
 * things the app does:
 *
 *   - **A card's name.** A card the answer points at by `index` is a line
 *     that has never been on a board. Minting its name is core's
 *     (`ids.js`), and the write that puts the name on the line is the app
 *     writing to its own format - not a plugin writing into a day file,
 *     which is the fork the board deliberately does not cross (design §6).
 *   - **Whether its task finished.** A tick is a decision recorded on the
 *     day page. A card ticked *yesterday* has no line on today's page, so a
 *     plugin shown one page cannot tell "done yesterday" from "deleted"; the
 *     app has the whole vault and looks the id up instead. The plugin then
 *     reads the marker the app wrote, which is the only clock its ageing
 *     rule has.
 *
 * Pure. Nothing here writes a file, mints a name, or reads a clock: it
 * returns the pages to write and the board to merge, and the caller does the
 * writing.
 */

/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */
/** @typedef {import('./vaultIndex.js').PageKey} PageKey */
/** @typedef {import('./board.js').Column} Column */
/** @typedef {import('./board.js').Answer} Answer */
/** @typedef {import('./boardFile.js').Placed} Placed */
/** @typedef {import('./boardFile.js').PlacedColumn} PlacedColumn */
/** @typedef {import('./boardFile.js').Card} FileCard */

import { lineWithId } from './ids.js'
import { parseBoard, serialiseBoard, FRESH } from './boardFile.js'

/**
 * The columns the file holds, which are the only columns an answer may name.
 *
 * An empty file reads as `FRESH` for the same reason the plugin and the merge
 * both do it: a vault that has never had a board still has three columns to
 * put a card in, and the file is written the first time one is (design §9,
 * created on first write).
 *
 * @param {string} text  `board.md` as it stands, `''` when there is none
 * @returns {string[]|null}  null when the file cannot be read, which is not
 *   the same as having no columns: nothing may be written over it
 */
export function columnsOf(text) {
  const { board } = parseBoard(text.trim() === '' ? FRESH : text)
  return board === null ? null : board.columns.map((column) => column.name)
}

/**
 * Every card the answer pointed at by line rather than by name, as places to
 * stamp.
 *
 * In answer order, which is the order `placeBoard` reads the names back in.
 * `stampAll` is what turns these into names, one pass for the whole list -
 * see the two things it exists to make impossible.
 *
 * @param {Column[]} columns
 * @param {PageKey} page  the page the board was asked about
 * @returns {{page: PageKey, at: number}[]}
 */
export function unnamed(columns, page) {
  /** @type {{page: PageKey, at: number}[]} */
  const places = []
  for (const column of columns) {
    for (const card of column.cards) {
      if (card.index !== null) places.push({ page, at: card.index })
    }
  }
  return places
}

/**
 * How a card's task actually ended, which is the state of the line holding
 * its name (design §6).
 *
 * `done` and `dropped` are the two ways a day page records that a task is
 * finished with, and the archive keeps them apart because the day page does.
 * `open` and `migrated` are not endings, and a line that was open again is a
 * card that is in flight again - unticking is as much a decision as ticking,
 * and the marker is the app's to take off as well as to put on.
 *
 * No line at all keeps whatever the file had. A card whose task is nowhere in
 * the vault is a card the app knows nothing new about: absence is not a
 * decision, and reading it as one would strip the marker off every card whose
 * line somebody deleted.
 *
 * Where two lines hold one name the latest day wins, which `idIndex` resolves
 * and `move.js` deliberately creates.
 *
 * @param {VaultIndex} index
 * @param {string} id
 * @param {'done'|'dropped'|null} held  what the file has
 * @returns {'done'|'dropped'|null}
 */
export function endingFor(index, id, held) {
  const found = lineWithId(index, id)
  if (found === null) return held
  const state = found.item.state
  return state === 'done' || state === 'dropped' ? state : null
}

/**
 * The answer as an arrangement to merge: every card named, every ending the
 * vault's rather than the plugin's, and a finished card in the done column.
 *
 * The last column is the done column by position and not by name (design
 * §3.1), so a card the app found ticked is moved to the end of it whatever
 * the answer said. A `dropped` card is *not* moved: a struck line is a
 * decision that was made, not a completion, and the column it was in is where
 * that decision is legible. Both age out of the board the same way, which is
 * the plugin's rule and not this one's.
 *
 * `ids[n]` is the name of the nth card the answer pointed at by line, in the
 * order `unnamed` listed them - so the two are read together or not at all.
 *
 * @param {Column[]} columns
 * @param {string[]} ids
 * @param {VaultIndex} index
 * @returns {PlacedColumn[]}
 */
export function placeBoard(columns, ids, index) {
  const naming = [...ids]
  /** @type {PlacedColumn[]} */
  const placed = columns.map((column) => ({ name: column.name, cards: [] }))
  /** @type {Placed[]} */
  const finished = []

  columns.forEach((column, at) => {
    const into = placed[at]
    if (into === undefined) return
    for (const card of column.cards) {
      // A card pointed at by line takes the name minted for it; one that came
      // back with a name keeps it. `readCard` guarantees exactly one of the
      // two, so this is a read and not a choice.
      const id = card.id ?? naming.shift() ?? null
      if (id === null) continue
      const ended = endingFor(index, id, card.ended)
      const made = { id, text: card.text, ended }
      if (ended === 'done') finished.push(made)
      else into.cards.push(made)
    }
  })

  // The done column, which is the last one - or the only one, when a file has
  // been cut down to one heading. A board with no columns at all has nowhere
  // to put a finished card, and it stays off the arrangement rather than
  // being invented a column of its own.
  const done = placed[placed.length - 1]
  if (done !== undefined) done.cards.push(...finished)
  return placed
}

/**
 * The cards to move into `archive.md`, as the board file holds them.
 *
 * From the file rather than from the answer, because archiving is a move and
 * not a re-rendering: the line that goes into `archive.md` is the line
 * `board.md` had, with the marker the app wrote on it (design §3.2). In file
 * order, so the archive reads in board order rather than in whatever order a
 * plugin listed.
 *
 * A card the file does not hold as ended is refused. The archive is
 * append-only and a card taken off the board is off it for good, so a plugin
 * naming an in-flight card would be deleting a task through a door the design
 * does not open. The plugin only ever names ended cards; this is what makes
 * that a property of the app rather than a habit of one plugin.
 *
 * @param {string} text  `board.md` as it stands
 * @param {string[]} ids  the names the answer asked to archive
 * @returns {{cards: FileCard[], notices: string[]}}
 */
export function archiving(text, ids) {
  /** @type {string[]} */
  const notices = []
  if (ids.length === 0) return { cards: [], notices }

  const { board } = parseBoard(text.trim() === '' ? FRESH : text)
  if (board === null) return { cards: [], notices }

  const asked = new Set(ids)
  /** @type {FileCard[]} */
  const cards = []
  /** @type {Set<string>} */
  const seen = new Set()
  let refused = 0
  for (const column of board.columns) {
    for (const entry of column.entries) {
      if (entry.kind !== 'card') continue
      const card = entry.card
      if (!asked.has(card.id) || seen.has(card.id)) continue
      seen.add(card.id)
      if (card.ended === null) {
        refused += 1
        continue
      }
      cards.push(card)
    }
  }

  if (refused > 0) {
    notices.push(`the board asked to archive ${refused} ${refused === 1 ? 'card' : 'cards'} nothing has finished`)
  }
  return { cards, notices }
}

/**
 * The board with one card moved into another column.
 *
 * This is the drop (design §5). A drag is the app's gesture end to end - the
 * plugin never sees a pointer event and is not asked whether the move is
 * allowed - so this rearranges the file directly, and the plugin learns of it
 * the next time it is asked. Which is also what makes a drop survive a plugin
 * that is slow, switched off, or put away mid-gesture.
 *
 * The card is moved, never re-rendered: the `raw` line it was read from is
 * what goes back in, so a card keeps its exact words, its ending marker and
 * any spacing somebody typed by hand. A drop says where a card is, and
 * nothing else about it.
 *
 * `before` is the card the moved one lands in front of, or null for the end
 * of the column - which is how a drop on the empty space below the last card
 * differs from a drop on a card. A `before` the column does not hold is read
 * as the end rather than refused: the board under the pointer is a drawing of
 * the file as it was read, and a card that has since moved is a stale drawing
 * rather than a bad gesture.
 *
 * Null when the move cannot be made, and the caller leaves the file alone:
 * the file cannot be read, no column has that name, or no card has that id.
 * A move to the column the card is already in is a real move - that is how a
 * card is reordered inside a column - but one that changes nothing comes back
 * as the text it was given, so a drop that put a card back where it was is
 * not a write.
 *
 * @param {string} text  the board as it stands
 * @param {string} id  the card being dropped
 * @param {string} column  the column it is dropped in, by name
 * @param {string|null} before  the card it lands in front of, or null for last
 * @returns {string|null}
 */
export function moveCard(text, id, column, before) {
  const { board } = parseBoard(text.trim() === '' ? FRESH : text)
  if (board === null) return null
  if (!board.columns.some((one) => one.name === column)) return null

  /** @type {import('./boardFile.js').Entry|null} */
  let moving = null
  const without = board.columns.map((one) => ({
    ...one,
    entries: one.entries.filter((entry) => {
      // First one wins, the same rule the draw and the merge both follow, so
      // a file holding one id twice moves the card it draws.
      if (entry.kind !== 'card' || entry.card.id !== id || moving !== null) return true
      moving = entry
      return false
    }),
  }))
  if (moving === null) return null
  // Read out of the closure the filter wrote it in, so what follows is
  // holding an entry rather than a variable that was one a moment ago.
  const card = moving
  const merged = without.map((one) => {
    if (one.name !== column) return one
    const at = before === null
      ? slotIn(one.entries)
      : one.entries.findIndex((entry) => entry.kind === 'card' && entry.card.id === before)
    const entries = [...one.entries]
    entries.splice(at === -1 ? slotIn(one.entries) : at, 0, card)
    return { ...one, entries }
  })

  return serialiseBoard({ preamble: board.preamble, columns: merged })
}

/**
 * Where a card appended to a column goes: after its last card, or - in a
 * column that has none - after the blank line the heading is followed by.
 *
 * The first half is `mergeBoard`'s rule, and for its reason: a card written
 * after whatever blank line ends the column lands against the next heading and
 * reads as belonging to it.
 *
 * The second half is this function's own, and it is about a column a card has
 * just left. `## To do` holding one card is a blank line, the card, a blank
 * line; take the card out and looking for the last card finds none, so the
 * card would come back at the top and push the blank line below it. A drop
 * that put a card back where it was would rewrite the file - which is exactly
 * the write this is meant not to make.
 *
 * @param {import('./boardFile.js').Entry[]} entries
 * @returns {number}
 */
function slotIn(entries) {
  for (let n = entries.length - 1; n >= 0; n -= 1) {
    if (entries[n]?.kind === 'card') return n + 1
  }
  const first = entries[0]
  return first !== undefined && first.kind === 'text' && first.line.trim() === '' ? 1 : 0
}
