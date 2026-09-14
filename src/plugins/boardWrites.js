// @ts-check

/**
 * The writes a board's answer turns into (kanban design §6, §9).
 *
 * `pageAsking.js` puts the question and `boardWrite.js` decides what the
 * answer means; this is where the decision reaches disk. Three files may
 * change from one answer, and the order they change in is the whole of what
 * this module has to get right:
 *
 *   1. **The day page**, for a card the answer pointed at by line rather than
 *      by name. The app stamps the name (`ids.js`), which is the app writing
 *      to its own format - not a plugin writing into a day file.
 *   2. **`archive.md`**, for a card that has aged out. Before the board,
 *      always: if the board write then fails, the card is still on the board
 *      and the next draw archives it again - one duplicated line, in a file
 *      of identical lines, removable by hand. Board first and the archive
 *      failing would take the card off the board with nothing holding it.
 *      Ugly beats lost.
 *   3. **`board.md`**, merged rather than replaced, so a card the answer
 *      never mentioned keeps its place and an unrearranged board comes back
 *      byte for byte.
 *
 * Runs after every draw, and is a no-op on almost all of them: nothing needs
 * a name, nothing has aged, and the merge returns the file it was given. That
 * last one is what makes this cheap, and it is a property of `mergeBoard`
 * rather than a guess made here.
 */

import { BOARD, ARCHIVE } from '../core/board.js'
import { stampAll } from '../core/ids.js'
import { appendArchive, mergeBoard } from '../core/boardFile.js'
import { unnamed, placeBoard, archiving, moveCard } from '../core/boardWrite.js'

/** @typedef {import('../store.js').Store} Store */
/** @typedef {import('./pageAsking.js').Board} Board */

/**
 * The boards whose writes are in the air, by plugin name.
 *
 * A write tells the window it landed, the window draws, and a draw comes back
 * here - so without this the second draw would start the archive append the
 * first one has not finished. The archive is append-only and the file has no
 * watcher behind it, so that duplicate would be permanent and unnoticed: the
 * one place in this path where doing the work twice is not merely wasteful.
 *
 * Module scope, like the window's own chrome, because there is one spread
 * window per webview and these are its writes.
 *
 * @type {Set<string>}
 */
const inFlight = new Set()

/**
 * Keeps every board's file in step with what its plugin answered and what the
 * vault says happened.
 *
 * One board at a time rather than all at once: two boards are two folders and
 * two files, and a plugin whose write fails has no business holding up the
 * one beside it.
 *
 * @param {Store} store
 * @param {string} page  the day the boards were asked about
 * @param {Board[]} boards  exactly what `boardsFor` returned
 * @param {string} today  `YYYY-MM-DD`, for a card that is ending now
 * @returns {Promise<void>}
 */
export async function keepBoards(store, page, boards, today) {
  for (const board of boards) await keepBoard(store, page, board, today)
}

/**
 * @param {Store} store
 * @param {string} page
 * @param {Board} board
 * @param {string} today
 * @returns {Promise<void>}
 */
async function keepBoard(store, page, board, today) {
  const answer = board.answer
  if (answer === null) return
  if (inFlight.has(board.plugin)) return
  inFlight.add(board.plugin)
  try {
    await write(store, page, board, answer, today)
  } finally {
    inFlight.delete(board.plugin)
  }
}

/**
 * @param {Store} store
 * @param {string} page
 * @param {Board} board
 * @param {import('../core/board.js').Answer} answer
 * @param {string} today
 * @returns {Promise<void>}
 */
async function write(store, page, board, answer, today) {
  // Nobody has read the file yet, so there is nothing to merge onto. The read
  // is already in the air - `boardsFor` started it - and the draw it lands on
  // is the one that writes.
  if (!store.pluginFileKnown(board.plugin, BOARD)) return
  const held = store.pluginFile(board.plugin, BOARD) ?? ''

  // Names first, because everything after this is written in terms of them.
  const places = unnamed(answer.columns, page)
  const stamped = await stampNames(store, page, places, board.tab)
  if (stamped === null) return

  const leaving = await archiveEnded(store, board, held, answer.archive)
  if (leaving === null) return

  const merged = mergeBoard(held, placeBoard(answer.columns, stamped, store.vault()), today, leaving)
  if (merged === null) {
    // `parseBoard` refused the file, so there is nothing to write onto it and
    // nothing is written. Said once per draw rather than once per board write
    // that did not happen, because the file has not changed either.
    store.notice(`${board.tab}: this board's file cannot be read, so nothing was written to it.`)
    return
  }
  // The merge of an unrearranged board is the file it was given, byte for
  // byte, which is what keeps a draw from being a write.
  if (merged === held) return
  await store.changePluginFile(board.plugin, BOARD, merged)
}

/**
 * The names for the cards that came back pointed at by line, stamping the day
 * page where one was missing.
 *
 * Null when the page could not be written, which takes the whole board's
 * write with it: an arrangement holding a name that never reached a line is a
 * board full of cards pointing at nothing.
 *
 * @param {Store} store
 * @param {string} page
 * @param {{page: string, at: number}[]} places
 * @param {string} tab
 * @returns {Promise<string[]|null>}
 */
async function stampNames(store, page, places, tab) {
  if (places.length === 0) return []

  /** @type {{ids: string[], writes: {page: string, doc: import('../core/model.js').Document}[]}} */
  let minted
  try {
    // From `freshest` rather than from the index as drawn: a line added a
    // moment ago may still be in the post, and stamping refuses an index that
    // does not point at an item rather than writing to the wrong line.
    minted = stampAll(store.freshest([page]), places)
  } catch {
    // The answer is about a page that has moved under it. The next draw asks
    // again against the page as it now is, which is the right answer to a
    // stale question and not something to tell anybody about.
    return null
  }

  for (const write of minted.writes) {
    const done = await store.change(write.page, () => write.doc)
    if (!done) {
      store.notice(`${tab}: a card could not be named, so the board was left as it was.`)
      return null
    }
  }
  return minted.ids
}

/**
 * The names to take off the board, written into `archive.md` first.
 *
 * Null when the archive could not be written, which holds the board's write
 * back: a card taken off the board with nothing holding it is a task lost, and
 * leaving it on for another draw costs nothing but a second look at it.
 *
 * @param {Store} store
 * @param {Board} board
 * @param {string} held  `board.md` as it stands
 * @param {string[]} asked  the names the answer wants archived
 * @returns {Promise<string[]|null>}
 */
async function archiveEnded(store, board, held, asked) {
  if (asked.length === 0) return []

  const { cards, notices } = archiving(held, asked)
  for (const line of notices) store.notice(`${board.tab}: ${line}`)
  if (cards.length === 0) return []

  // The same read-before-write rule the board has. An archive is append-only,
  // so appending to a file nobody has read would not add to it - it would
  // replace it with its own last page.
  if (!store.pluginFileKnown(board.plugin, ARCHIVE)) {
    store.pluginFile(board.plugin, ARCHIVE)
    return null
  }
  const before = store.pluginFile(board.plugin, ARCHIVE) ?? ''
  const done = await store.changePluginFile(board.plugin, ARCHIVE, appendArchive(before, cards))
  if (!done) return null
  return cards.map((card) => card.id)
}

/**
 * A card dropped in another of a board's columns.
 *
 * The gesture is the app's end to end (design §5): the plugin is not asked
 * whether the move is allowed and does not hear about it until it is next
 * asked, which is what makes a drop survive a plugin that is slow, switched
 * off, or put away mid-drag.
 *
 * Nothing here undoes itself on the next draw, and the reason is worth saying
 * because it is not local to this function: `boardsFor` keys the answer cache
 * on the file's own text, so the write below is a new question, and the
 * arrangement `keepBoards` merges a moment later is the one the plugin made
 * *after* seeing the card move. Were it keyed on the day alone, the stale
 * answer would fill the vacancy this write just made and put the card back.
 *
 * Silent when the move cannot be made - the card or the column is not in the
 * file. That is a board drawn from a file that has since changed, the same
 * stale-drawing case a stale line index is, and the next draw is the answer
 * to it rather than a line in the notice band. A file nothing can read is
 * already said once per draw by the write path, so it is not said twice here.
 *
 * @param {Store} store
 * @param {string} plugin
 * @param {string} id  the card being dropped
 * @param {string} column  the column it is dropped in, by name
 * @param {string|null} before  the card it lands in front of, or null for last
 * @returns {Promise<void>}
 */
export async function dropCard(store, plugin, id, column, before) {
  // The same read-before-write rule the merge has, and here it is the whole
  // of the check: a board nobody has read is a board with no card to move.
  if (!store.pluginFileKnown(plugin, BOARD)) return
  const held = store.pluginFile(plugin, BOARD) ?? ''
  const moved = moveCard(held, id, column, before)
  if (moved === null || moved === held) return
  await store.changePluginFile(plugin, BOARD, moved)
}
