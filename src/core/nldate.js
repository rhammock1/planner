// @ts-check

/**
 * Natural-language entry: a typed line -> the day, time and deadline in it
 * (spec §5.5).
 *
 * Deliberately small. The vocabulary here is the whole vocabulary; anything
 * outside it stays part of the text. When a reading would consume words the
 * user likely meant literally, the literal reading wins - `review PR #4412`
 * is not a time, and `buy 4 bolts` is not four o'clock.
 *
 * Pure: today's date is an argument, never a clock.
 */

import { isValidDate, isValidTime } from './model.js'
import { addDays, nextWeekday } from './dates.js'

/**
 * @typedef {object} Entry
 * @property {string} text  what is left once the phrases are lifted out
 * @property {string|null} date  the day this lands on; null means unspecified
 * @property {string|null} time  `HH:MM`
 * @property {string|null} due   `YYYY-MM-DD`
 */

/** @typedef {(match: RegExpMatchArray, today: string) => string|null} Resolver */
/** @typedef {{core: string, resolve: Resolver}} Matcher */

/**
 * Longest first, so `monday` is never cut short to `mon`.
 *
 * The abbreviations stop where English words begin. `sat`, `sun` and `wed`
 * are omitted deliberately: reading "sat with the team" as a Saturday, or
 * "sun in my eyes" as a Sunday, is exactly the over-eager parse spec §5.5
 * rules against. Their full names still work.
 */
const WEEKDAYS = [
  ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3],
  ['thursday', 4], ['friday', 5], ['saturday', 6],
  ['tues', 2], ['thurs', 4],
  ['mon', 1], ['tue', 2], ['thu', 4], ['fri', 5],
]

const MONTHS = [
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11],
  ['december', 12],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['jun', 6], ['jul', 7], ['aug', 8],
  ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
]

/** @type {Map<string, number>} */
const WEEKDAY_NUMBERS = new Map(/** @type {[string, number][]} */ (WEEKDAYS))
/** @type {Map<string, number>} */
const MONTH_NUMBERS = new Map(/** @type {[string, number][]} */ (MONTHS))

const WEEKDAY_WORDS = WEEKDAYS.map(([name]) => name).join('|')
const MONTH_WORDS = MONTHS.map(([name]) => name).join('|')

/** @type {Matcher[]} */
const DATE_MATCHERS = [
  { core: 'today', resolve: (_match, today) => today },
  { core: 'tomorrow', resolve: (_match, today) => addDays(today, 1) },
  {
    core: `(${WEEKDAY_WORDS})`,
    resolve: (match, today) => {
      const weekday = WEEKDAY_NUMBERS.get((match[1] ?? '').toLowerCase())
      return weekday === undefined ? null : nextWeekday(today, weekday)
    },
  },
  { core: 'in (\\d+) days?', resolve: (match, today) => addDays(today, Number(match[1])) },
  {
    // An explicit date is a statement, not a guess: it is taken as written,
    // past or future. That is how a note gets filed on the day it belongs to.
    core: '(\\d{4}-\\d{2}-\\d{2})',
    resolve: (match) => (match[1] !== undefined && isValidDate(match[1]) ? match[1] : null),
  },
  {
    core: '(\\d{1,2})/(\\d{1,2})',
    resolve: (match, today) => nextDateOf(Number(match[1]), Number(match[2]), today),
  },
  {
    core: `(${MONTH_WORDS}) (\\d{1,2})`,
    resolve: (match, today) => {
      const month = MONTH_NUMBERS.get((match[1] ?? '').toLowerCase())
      return month === undefined ? null : nextDateOf(month, Number(match[2]), today)
    },
  },
]

/** @type {Matcher[]} */
const TIME_MATCHERS = [
  {
    core: '(?:at\\s+)?(\\d{1,2}):(\\d{2})\\s*(am|pm)?',
    resolve: (match) => timeOf(Number(match[1]), Number(match[2]), match[3]),
  },
  {
    core: '(?:at\\s+)?(\\d{1,2})\\s*(am|pm)',
    resolve: (match) => timeOf(Number(match[1]), 0, match[2]),
  },
  {
    // A bare number is only a time when `at` says so. Without that guard,
    // `read chapter 8` becomes an eight o'clock appointment.
    core: 'at\\s+(\\d{1,2})',
    resolve: (match) => timeOf(Number(match[1]), 0, undefined),
  },
]

/**
 * @param {string} input the line as typed
 * @param {string} today `YYYY-MM-DD`
 * @returns {Entry}
 */
export function parseEntry(input, today) {
  let text = input

  // Deadlines come out first: `by friday` must be read whole, or the bare
  // date pass would take `friday` and leave a dangling `by`.
  const due = lift(text, DATE_MATCHERS, today, '(?:by|due)\\s+')
  text = due.text

  const date = lift(text, DATE_MATCHERS, today, '')
  text = date.text

  const time = lift(text, TIME_MATCHERS, today, '')
  text = time.text

  return { text: text.trim(), date: date.value, time: time.value, due: due.value }
}

/**
 * Finds the earliest phrase any matcher recognises and splices it out.
 *
 * Earliest wins rather than first-matcher-wins so that the phrase a reader
 * would notice first is the one that counts. A matcher that recognises the
 * shape but cannot resolve it - `13/45`, `10:99` - is passed over, and the
 * words stay in the text where the user can see them.
 *
 * @param {string} text
 * @param {Matcher[]} matchers
 * @param {string} today `YYYY-MM-DD`
 * @param {string} prefix regex source required before the phrase, or ''
 * @returns {{text: string, value: string|null}}
 */
function lift(text, matchers, today, prefix) {
  /** @type {{index: number, length: number, value: string}|null} */
  let best = null

  for (const matcher of matchers) {
    const pattern = new RegExp(`(?:^|\\s)${prefix}${matcher.core}(?=\\s|$)`, 'gi')
    for (const match of text.matchAll(pattern)) {
      const value = matcher.resolve(match, today)
      if (value === null || match.index === undefined) continue
      if (best === null || match.index < best.index) {
        best = { index: match.index, length: match[0].length, value }
      }
      break
    }
  }

  if (best === null) return { text, value: null }
  // The pattern consumes the whitespace before the phrase and none after, so
  // splicing it out leaves exactly one separator behind - the same trick the
  // vault parser uses to avoid welding two words together.
  return {
    text: text.slice(0, best.index) + text.slice(best.index + best.length),
    value: best.value,
  }
}

/**
 * The next occurrence of a month and day, today included.
 *
 * A day-of-year that has already gone by means the one coming up: typing
 * `12/25` in December must not file the entry eleven months into the past.
 *
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @param {string} today `YYYY-MM-DD`
 * @returns {string|null} null when no such calendar date exists
 */
function nextDateOf(month, day, today) {
  const thisYear = Number(today.slice(0, 4))
  for (const year of [thisYear, thisYear + 1]) {
    const candidate = `${year}-${pad(month)}-${pad(day)}`
    if (isValidDate(candidate) && candidate >= today) return candidate
  }
  return null
}

/**
 * An hour with no am/pm attached is read the way a person writing in a
 * planner means it: 1 through 6 is the afternoon, everything else is taken at
 * face value. The quick-add preview (spec §5.2) shows the result before it is
 * committed, so a wrong guess is visible rather than silent.
 *
 * @param {number} hours as written
 * @param {number} minutes
 * @param {string|undefined} meridiem `am`, `pm`, or absent
 * @returns {string|null} `HH:MM`, or null when there is no such time
 */
function timeOf(hours, minutes, meridiem) {
  const suffix = meridiem?.toLowerCase()
  let hour = hours
  if (suffix === 'am') hour = hours % 12
  else if (suffix === 'pm') hour = (hours % 12) + 12
  else if (hours >= 1 && hours <= 6) hour = hours + 12

  if (suffix !== undefined && (hours < 1 || hours > 12)) return null
  if (!isValidTime(hour, minutes)) return null
  return `${pad(hour)}:${pad(minutes)}`
}

/**
 * @param {number} n
 * @returns {string}
 */
function pad(n) {
  return String(n).padStart(2, '0')
}
