// @ts-check

/**
 * A block under the day for each meeting, and a file beside the day to keep
 * it in.
 *
 * The second thing this API has ever let a plugin do to somebody's vault, and
 * the smaller half of it: this plugin decides what a note is *called* and
 * where it belongs, and never writes a byte. You type into the block; the app
 * writes the file (spec §4.1).
 *
 * Note what is not here. No filename arithmetic - `suffixFor` below is a copy
 * of the app's own function, not a call to it: `tools/update` installs a
 * plugin by copying its folder alone, and `plugin://<name>/` refuses any path
 * that climbs out of that folder, so an `import` reaching back into
 * `src/core/` would type-check here and 404 the moment this plugin was
 * installed. No clock: the day being drawn arrives in the question. No
 * storage: the vault is the storage, and a `meeting-` file on a day *is* the
 * record that the note exists.
 */

/** The prefix this plugin's manifest claims. One place, so a rename is one
 *  edit in two files rather than four in one. */
const MINE = 'meeting'

/** How far either side of today the search provider looks (spec §4.2). */
const REACH = 60

/**
 * `LONGEST_STEM`, `LONGEST_PREFIX`, `isPrefix`, `stemOf` and `suffixFor` below
 * are copied verbatim from `src/core/sidecars.js` - see the note at the top
 * of this file for why they cannot be imported. Keep them byte-for-byte the
 * rule there: a plugin that computes a different suffix than the app does
 * names a file the app then cannot find.
 */

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
const LONGEST_PREFIX = 64 - LONGEST_STEM - 1

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
planner.on('page.section', async ({ date, sidecars }) => {
  const events = await planner.capability('macos.calendar.read').events({ from: date, to: date })

  /** Suffix to block, so an event whose note exists is one block and not two. */
  const blocks = new Map()

  // The notes that exist come first and in the order the host listed them,
  // which is the order they are on disk. A note you have written outranks an
  // offer of one you have not.
  for (const one of sidecars) blocks.set(one.suffix, { suffix: one.suffix })

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
  for (const one of [...mine].reverse()) {
    if (hits.length >= 20) break

    // A title that matches is worth a hit of its own, before the file is even
    // read: it is the thing you actually remember about a meeting.
    if (one.title.toLowerCase().includes(wanted)) {
      hits.push({ text: one.title, date: one.date, href: sidecarRef(one.date, one.suffix) })
      continue
    }

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
