// @ts-check

/**
 * What the creature is feeling, and what it has been feeling lately.
 *
 * The whole of the decision is four integers in and one word out. That is not
 * a simplification for the sake of a small plugin - it is the shape of the
 * `page.box` question, which hands a plugin counts and never a line's words
 * (phase four §1.1). A creature that reacted to *what* you wrote would need to
 * be told, and then the margin would be a place your writing goes.
 *
 * Pure, and in its own file so it can be tested the way `dusk`'s arithmetic is:
 * under `node --test`, with no `planner` global in the room.
 */

/** @typedef {{open: number, done: number, due: number, overdue: number}} Glance */
/** @typedef {'fresh'|'working'|'fretting'|'resting'} Mood */
/** @typedef {{date: string} & Glance} Day */

/** The four, in the order they are decided. */
export const MOODS = /** @type {const} */ (['fretting', 'resting', 'working', 'fresh'])

/** How many days the creature keeps. A week, so a bad week reads differently
 *  from a bad afternoon - which is the only thing the history is for. */
export const REMEMBERED = 7

/**
 * One mood, from one day's four counts.
 *
 * The order is the whole table. `overdue` wins over everything, because a day
 * with something late on it is that day whatever else is true of it. `resting`
 * wins over the rest, because a day with nothing open is done rather than
 * quietly working - a creature still leaning in over an empty page is a
 * creature that is pretending.
 *
 * @param {Glance} glance
 * @returns {Mood}
 */
export function moodOf(glance) {
  if (glance.overdue > 0) return 'fretting'
  if (glance.open === 0) return 'resting'
  if (glance.done > 0) return 'working'
  return 'fresh'
}

/**
 * The history, as it should be after today.
 *
 * Today replaces any entry already held for the same date rather than being
 * appended beside it: a day is looked at many times, and a history that grew
 * once per keystroke would be a week of one afternoon.
 *
 * @param {unknown} stored  whatever was in storage, which is a file a person
 *   can edit and so is not to be believed
 * @param {string} date  `YYYY-MM-DD`
 * @param {Glance} glance
 * @returns {Day[]}  oldest first, at most `REMEMBERED`
 */
export function remembered(stored, date, glance) {
  const kept = days(stored).filter((day) => day.date !== date)
  kept.push({ date, ...counts(glance) })
  kept.sort((one, other) => (one.date < other.date ? -1 : one.date > other.date ? 1 : 0))
  return kept.slice(-REMEMBERED)
}

/**
 * How many remembered days in a row, ending with the most recent, have been
 * the same mood as the most recent.
 *
 * Remembered days rather than calendar days, and the difference is deliberate:
 * a day nobody opened the planner on is a day this plugin knows nothing about,
 * and guessing it was a good one to keep a streak alive - or a bad one to
 * break it - would be inventing the thing the creature is meant to be
 * reporting.
 *
 * @param {Day[]} history  as `remembered` returns it
 * @returns {number}  0 for an empty history, otherwise at least 1
 */
export function streak(history) {
  const last = history[history.length - 1]
  if (last === undefined) return 0

  const mood = moodOf(last)
  let run = 0
  for (let at = history.length - 1; at >= 0; at -= 1) {
    const day = history[at]
    if (day === undefined || moodOf(day) !== mood) break
    run += 1
  }
  return run
}

/**
 * How far into a streak this is, as 0 to 1.
 *
 * What the drawing actually takes. A first day is 0 and a full week is 1, so
 * the streak moves the creature *within* its mood - a fretting creature frets
 * harder, a resting one sleeps sounder - rather than giving it a fifth face.
 *
 * @param {number} run  as `streak` counts it
 * @returns {number}
 */
export function deepening(run) {
  if (run <= 1) return 0
  return Math.min(run - 1, REMEMBERED - 1) / (REMEMBERED - 1)
}

/**
 * The four counts of a glance, and nothing that came with them.
 *
 * @param {Glance} glance
 * @returns {Glance}
 */
function counts(glance) {
  return {
    open: whole(glance.open),
    done: whole(glance.done),
    due: whole(glance.due),
    overdue: whole(glance.overdue),
  }
}

/**
 * Whatever storage held, as days.
 *
 * Everything that is not a day is dropped rather than refused. The file is the
 * plugin's own, but it is a file - a person may have opened it, and a creature
 * that refuses to draw because one line of its diary is malformed is worse
 * than one that has forgotten a day.
 *
 * @param {unknown} stored
 * @returns {Day[]}
 */
function days(stored) {
  if (!Array.isArray(stored)) return []
  /** @type {Day[]} */
  const kept = []
  for (const one of stored) {
    if (typeof one !== 'object' || one === null) continue
    const day = /** @type {Record<string, unknown>} */ (one)
    if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(day.date)) continue
    kept.push({
      date: day.date,
      open: whole(day.open),
      done: whole(day.done),
      due: whole(day.due),
      overdue: whole(day.overdue),
    })
  }
  return kept
}

/**
 * A count, or zero for anything that is not one.
 *
 * @param {unknown} value
 * @returns {number}
 */
function whole(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}
