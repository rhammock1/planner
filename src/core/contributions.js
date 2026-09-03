// @ts-check

/**
 * What a plugin sent, turned into something a page can show (addendum §5).
 *
 * This is the only place a plugin's output is believed, and it is believed
 * one field at a time. Everything here arrived from somebody else's code:
 * the shape is checked, the text is flattened to a single line, and anything
 * that does not survive is dropped and counted rather than drawn.
 *
 * Pure. It never sees the DOM, so an event's text cannot be markup by the
 * time a view has it - the view sets `textContent` and the text is a string.
 */

/** @typedef {{time: string|null, text: string}} Event */

/** A day's worth of a line, and no more. Longer is a paste, not an event. */
const LONGEST = 200

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * The events the plugins contributed to one day.
 *
 * @param {{plugin: string, value: unknown}[]} answers  what each plugin said
 * @param {string} page  `YYYY-MM-DD`
 * @returns {{events: Event[], notices: string[]}}
 */
export function readContributions(answers, page) {
  /** @type {Event[]} */
  const events = []
  /** @type {string[]} */
  const notices = []
  let dropped = 0

  // The same holiday subscribed twice is one holiday. Two identical lines say
  // nothing the first did not, and the list below is keyed by what a line
  // says - so a duplicate would be two rows claiming the same key.
  const seen = new Set()

  for (const answer of answers) {
    if (!Array.isArray(answer.value)) {
      // Named, because with several plugins answering "a plugin" is not
      // enough to go and look at anything.
      notices.push(`${answer.plugin} returned something that is not a list`)
      continue
    }
    for (const item of answer.value) {
      const event = readOne(item, page)
      if (event === 'elsewhere') continue
      if (event === null) {
        dropped += 1
        continue
      }
      const key = `${event.time ?? ''}:${event.text}`
      if (seen.has(key)) continue
      seen.add(key)
      events.push(event)
    }
  }

  // Counted, not listed. One malformed item is worth saying; forty of them
  // would be forty lines of notice over a list of three tasks.
  if (dropped > 0) {
    notices.push(`A plugin sent ${dropped} ${dropped === 1 ? 'line' : 'lines'} this app could not read`)
  }

  return { events: sorted(events), notices }
}

/**
 * @param {unknown} item
 * @param {string} page
 * @returns {Event|null|'elsewhere'} null when it is for this day but unusable
 */
function readOne(item, page) {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null

  const fields = /** @type {Record<string, unknown>} */ (item)
  const date = fields['date']
  if (typeof date !== 'string' || !DATE.test(date)) return null
  // Another day's event is not a fault. The app asks for a range and takes
  // from the answer what belongs on the page it is drawing.
  if (date !== page) return 'elsewhere'

  const text = flatten(fields['text'])
  if (text === '') return null

  // An hour this app cannot read is not worth guessing at, but the event
  // itself still happened: it shows as one without a time.
  const raw = fields['time']
  const time = typeof raw === 'string' && TIME.test(raw) ? raw : null

  return { time, text }
}

/**
 * One line, however many the plugin sent.
 *
 * A newline in an event title would otherwise put a plugin in charge of how
 * much of the page it takes up.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function flatten(raw) {
  if (typeof raw !== 'string') return ''
  const line = raw.replace(/\s+/gu, ' ').trim()
  return line.length <= LONGEST ? line : `${line.slice(0, LONGEST - 1)}…`
}

/**
 * All-day things first - they are the frame the rest of the day sits in -
 * then by the clock. Ties break on the text so the order is the same twice.
 *
 * @param {Event[]} events
 * @returns {Event[]}
 */
function sorted(events) {
  return [...events].sort((left, right) => {
    if (left.time === right.time) return left.text.localeCompare(right.text)
    if (left.time === null) return -1
    if (right.time === null) return 1
    return left.time.localeCompare(right.time)
  })
}
