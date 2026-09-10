// @ts-check

/**
 * The day's events, from the calendars this Mac already has - and a note on
 * any one of them you want a note on.
 *
 * `meeting-notes` used to be a plugin of its own. It never really was one: a
 * contributed calendar event has no index into the day file - `linesOf()` in
 * `src/core/badges.js` walks only `doc.nodes` where `kind === 'item'`, so
 * `item.badge` and `item.action` can never address a meeting - and every
 * offer it made came from `macos.calendar.read`, the capability this plugin
 * already holds. With the calendar refused it produced nothing but editors
 * for files that already existed. One plugin owning both ends - the events
 * under the list, and a note on one of them - is the only move that needed no
 * new API, so the two folded into one (spec §1.2).
 *
 * A reference plugin, and the design's own test: it is written against the
 * public API with no privilege the API does not grant, and if it could not
 * be, the API would be wrong (spec §7.5).
 *
 * Note how little there is. Everything native happens on the other side of
 * `capability`; everything about timezones happened before the events got
 * here. `page.note` decides what a note is *called* and where it belongs,
 * and never writes a byte - you type into the note's own view; the app writes it
 * (spec §4.1). No clock: the day being drawn arrives in the question. No
 * storage: the vault is the storage, and a `meeting-` file on a day *is* the
 * record that the note exists.
 */

planner.onContribute(async ({ from, to }) => {
  const events = await planner.capability('macos.calendar.read').events({ from, to })

  return events
    // A meeting called off is not on your day. It stays in the calendar,
    // struck through, and EventKit goes on reporting it.
    .filter((event) => event.status !== 'cancelled')
    .map((event) => ({
      date: event.date,
      time: event.time,
      text: event.text,
    }))
})

/** The prefix this plugin's manifest claims. One place, so a rename is one
 *  edit in two files rather than four in one. */
const MINE = 'meeting'

/** How far either side of today the search provider looks (spec §4.2). */
const REACH = 60

/**
 * How many notes a query may open.
 *
 * A title match costs nothing - it is in the listing. Opening a file is an
 * IPC round trip, and a question has two seconds before the host counts it a
 * timeout and switches this plugin off. `list` gives back at most 500, so
 * without a ceiling a query matching no title opens all of them one after
 * another. Sixty is a guess rather than a measurement - nothing here times a
 * round trip against the deadline - chosen conservatively as the recency
 * window a plugin trades for staying switched on; checked against a real
 * vault in the app run at the end of this pull request rather than derived.
 * The reading is newest-first, so the sixty are the sixty most recent, and a
 * note older than that is still found by its title, which is the thing you
 * actually remember about a meeting.
 */
const MOST_READ = 60

/**
 * `LONGEST_SUFFIX`, `LONGEST_STEM`, `LONGEST_PREFIX`, `SUFFIX`, `isPrefix`,
 * `stemOf`, `suffixFor` and `sidecarRef` below are copied verbatim from
 * `src/core/sidecars.js`. Not an oversight to clean up: `tools/update`
 * installs a plugin by copying its folder alone, and `plugin://<name>/`
 * refuses any path that climbs out of that folder, so an `import` reaching
 * back into `src/core/` would type-check in this repo and 404 the moment
 * this plugin was actually installed. Duplication is the only way a plugin
 * can name a sidecar at all.
 *
 * Keep them byte-for-byte the rule there: a plugin that computes a different
 * suffix than the app does names a file the app then cannot find.
 * `test/plugin-sidecar-parity.test.js` holds this copy against the original
 * so drift is caught here rather than on somebody's day.
 */

/** The longest a suffix may be, prefix and all. */
const LONGEST_SUFFIX = 64

/** The longest a title's stem may be, before its prefix is put in front. */
const LONGEST_STEM = 48

/**
 * The longest a prefix may be.
 *
 * Not a taste: `prefix` + `-` + a 48-character stem has to fit in 64, so
 * anything over fifteen is a plugin that can name `Standup` and cannot name
 * the meeting with the long title. Refused at the manifest, where a person
 * can see it, rather than on the day it bites.
 */
const LONGEST_PREFIX = LONGEST_SUFFIX - LONGEST_STEM - 1

const SUFFIX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPrefix(value) {
  return typeof value === 'string' && value.length <= LONGEST_PREFIX && SUFFIX.test(value)
}

/**
 * A title, as a filename can hold it (spec §4.2).
 *
 * Lowercased, everything else collapsed to single hyphens, cut, and *then*
 * trimmed - in that order, because a cut that lands inside a hyphen run
 * otherwise leaves a trailing one, which is not a legal suffix.
 *
 * @param {string} title
 * @returns {string} `''` when nothing survives
 */
function stemOf(title) {
  if (typeof title !== 'string') return ''
  const collapsed = title.toLowerCase().replace(/[^a-z0-9]+/gu, '-')
  return collapsed.slice(0, LONGEST_STEM).replace(/^-+|-+$/gu, '')
}

/**
 * The suffix a title makes under a prefix.
 *
 * Two events with the same title on one day are one file, which is what a
 * person would do too.
 *
 * @param {string} prefix
 * @param {string} title
 * @returns {string} `''` when the title names nothing, or the prefix is not one
 */
function suffixFor(prefix, title) {
  if (!isPrefix(prefix)) return ''
  const stem = stemOf(title)
  if (stem === '') return ''
  return `${prefix}-${stem}`
}

/**
 * @param {string} date
 * @param {string} suffix
 * @returns {string}
 */
function sidecarRef(date, suffix) {
  return `sidecar:${date}/${suffix}`
}

/**
 * A block for each meeting on the day: the note if it exists, the offer of one
 * if it does not.
 *
 * The host has already told us which of our files are on this day, so nothing
 * here needs `vault.sidecar.read` at all - which is the point of the question
 * carrying them. The capability below is for searching.
 */
planner.on('page.note', async ({ date, sidecars }) => {
  /** Suffix to block, so an event whose note exists is one block and not two. */
  const blocks = new Map()

  // The notes that exist come first and in the order the host listed them,
  // which is the order they are on disk. A note you have written outranks an
  // offer of one you have not.
  for (const one of sidecars) blocks.set(one.suffix, { suffix: one.suffix })

  // A refused calendar - unticked in settings, or macOS itself saying no -
  // should cost you the offers of new notes, never the editors of ones you
  // already wrote. Those come from `sidecars` above and do not touch this
  // capability at all, so a rejection here only means no new offers this time.
  /** @type {Planner.CalendarEvent[]} */
  let events = []
  try {
    events = await planner.capability('macos.calendar.read').events({ from: date, to: date })
  } catch {
    events = []
  }

  for (const event of events) {
    // A meeting called off is not on your day, and does not want a note.
    if (event.status === 'cancelled') continue

    const suffix = suffixFor(MINE, event.text)
    // A title with no letters or digits in it names nothing, and there is no
    // file this plugin could ask the app to make.
    if (suffix === '') continue
    if (blocks.has(suffix)) continue

    blocks.set(suffix, { suffix, title: event.text })
  }

  return [...blocks.values()]
})

/**
 * Every line of every note of ours containing the query.
 *
 * One `list` call for a hundred and twenty days, because a call per day would
 * be a hundred and twenty calls inside the two seconds this has to answer in
 * (spec §4.1). The files are then read one at a time, newest first, and the
 * reading stops at the point where the answer is full - twenty hits is what
 * the app will show.
 */
planner.on('search.provide', async ({ now, query }) => {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') return []

  const notes = planner.capability('vault.sidecar.read')
  const mine = await notes.list({ from: dayOffset(now.date, -REACH), to: dayOffset(now.date, REACH) })

  /** @type {{text: string, date: string, href: string}[]} */
  const hits = []

  // Newest first: what you are looking for is far more often a note from this
  // week than one from two months ago, and this is what decides which twenty
  // survive when there are more.
  let opened = 0

  for (const one of [...mine].reverse()) {
    if (hits.length >= 20) break

    // A title that matches is worth a hit of its own, before the file is even
    // read: it is the thing you actually remember about a meeting.
    if (one.title.toLowerCase().includes(wanted)) {
      hits.push({ text: one.title, date: one.date, href: sidecarRef(one.date, one.suffix) })
      continue
    }

    // Newest first, so the ceiling is a recency window rather than an
    // arbitrary cut. A title past it is still matched - unless the twenty
    // hits above are already full of newer notes, the same as any other
    // note this far back.
    if (opened >= MOST_READ) continue
    opened += 1

    let text = ''
    try {
      text = await notes.read(one.date, one.suffix)
    } catch {
      // A note that has been deleted since the listing. Not worth a line on
      // somebody's search results.
      continue
    }

    for (const line of text.split('\n')) {
      if (hits.length >= 20) break
      if (!line.toLowerCase().includes(wanted)) continue
      hits.push({ text: line, date: one.date, href: sidecarRef(one.date, one.suffix) })
    }
  }

  return hits
})

/**
 * A date `days` either side of this one.
 *
 * `Date` for the arithmetic and UTC throughout: a page key is a calendar date
 * rather than an instant, so parsing it as UTC and reading it back as UTC is
 * what keeps a range from moving by a day at either end of a timezone.
 *
 * @param {string} date  `YYYY-MM-DD`
 * @param {number} days
 * @returns {string}
 */
function dayOffset(date, days) {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}
