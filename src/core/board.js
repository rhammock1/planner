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

export { CARD, cardOf, lineOf }
