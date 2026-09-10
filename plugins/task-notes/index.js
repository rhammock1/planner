// @ts-check

/**
 * A page of your own about a line, and a marker on the line that leads back
 * to it (spec §4.3).
 *
 * The problem this plugin exists to solve is that a line has no identity. It
 * is a position in a file and some words; the position moves under any edit
 * above it, and carry-forward copies the words onto a new date every morning.
 * So the note is keyed on the *words* - kebab-cased, the same arithmetic the
 * app uses for a meeting's title - and this plugin **looks back**: it lists
 * its own notes for the last thirty days in one call and takes the newest
 * `note-<kebab>` on or before the day being drawn. A carried line keeps its
 * marker, and the note stays on the day it was written, where it was written.
 *
 * Editing the words orphans the marker. That is the cost the design accepted
 * over the two alternatives - a token in the line, which extends the token
 * grammar from a plugin, and a content hash in storage, which orphans on the
 * same edit with the mapping invisible in the vault (spec §4.3).
 *
 * Note what is not here. No filename arithmetic of its own - `suffixFor`
 * below is a copy of the app's function, not a call to it, because
 * `tools/update` installs a plugin by copying its folder alone and
 * `plugin://<name>/` refuses any path that climbs out of it. No writing: this
 * plugin names a file and the app makes it, and the words at the top of it
 * are your line, not anything this plugin chose.
 */

/** The prefix this plugin's manifest claims. One place, so a rename is one
 *  edit in two files rather than four in one. */
const MINE = 'note'

/**
 * How far back a note may be and still be found from a line.
 *
 * Thirty days is the carry-forward window: a line that has been carried every
 * morning for a month is still the same line, and its note is still its note.
 * Older than that and the marker goes, though the file stays exactly where it
 * was written - nothing is lost, and ⌘F still finds it.
 */
const LOOK_BACK = 30

/**
 * `LONGEST_SUFFIX`, `LONGEST_STEM`, `LONGEST_PREFIX`, `SUFFIX`, `isPrefix`,
 * `stemOf`, `suffixFor` and `sidecarRef` below are copied verbatim from
 * `src/core/sidecars.js` - see the note at the top of this file for why they
 * cannot be imported. Keep them byte-for-byte the rule there: a plugin that
 * computes a different suffix than the app does names a file the app then
 * cannot find. `test/plugin-sidecar-parity.test.js` holds the copies against
 * each other so drift is caught here rather than on somebody's day.
 *
 * Copy them out of `plugins/macos-calendar/index.js`, which already carries
 * the same set and is already held against core by that test - two copies
 * that agree is one thing to keep true, three that disagree is a bug hunt.
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
 * `dayOffset` is copied from `plugins/macos-calendar/index.js` rather than
 * from `src/core/dates.js`, whose `addDays` computes the same answer by
 * different arithmetic. It is **not** covered by the parity test, because it
 * has no twin in `src/core/sidecars.js` - so if you change it, change it in
 * both plugins.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {number} days
 * @returns {string} `YYYY-MM-DD`
 */
function dayOffset(date, days) {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/**
 * Every note of ours from the last thirty days up to the day being drawn.
 *
 * One call, not thirty-one: a question has two seconds, and a call per day
 * would spend them (spec §4.1). Up to the *page's* date rather than to today,
 * because a note is found relative to the page you are looking at - on
 * Friday's page, a note written next Monday is not yet a thing that happened.
 *
 * @param {string} date the day being drawn, `YYYY-MM-DD`
 * @returns {Promise<Planner.SidecarFile[]>}
 */
async function lookBack(date) {
  const notes = planner.capability('vault.sidecar.read')
  return await notes.list({ from: dayOffset(date, -LOOK_BACK), to: date })
}

/**
 * The newest note with this suffix, or null.
 *
 * `list` answers in date then suffix order, so the last match is the newest.
 * Newest rather than first because a line whose note was made twice - the
 * words edited back to what they were, a month apart - should open the one
 * you were most recently writing in.
 *
 * @param {Planner.SidecarFile[]} mine
 * @param {string} suffix
 * @returns {Planner.SidecarFile|null}
 */
function newestFor(mine, suffix) {
  for (let at = mine.length - 1; at >= 0; at -= 1) {
    const one = mine[at]
    if (one !== undefined && one.suffix === suffix) return one
  }
  return null
}

/**
 * `✎` after every line that has a note.
 *
 * One `list` for the whole page rather than one per line: there may be thirty
 * lines and there is one window to look back over.
 */
planner.on('item.badge', async ({ date, items }) => {
  /** @type {Planner.SidecarFile[]} */
  let mine = []
  try {
    mine = await lookBack(date)
  } catch {
    // The capability unticked, or the door refusing. No markers this time,
    // which is the truthful answer: without the listing this plugin does not
    // know which lines have notes.
    return []
  }

  /** @type {Planner.Badge[]} */
  const badges = []
  for (const item of items) {
    const suffix = suffixFor(MINE, item.text)
    // A line with no letters or digits in it names nothing.
    if (suffix === '') continue

    const found = newestFor(mine, suffix)
    if (found === null) continue

    // The day it was written, not the day the line is on: that is the whole
    // of the carried-line answer, and the app knows to go there first.
    badges.push({ index: item.index, label: '✎', href: sidecarRef(found.date, suffix) })
  }
  return badges
})

/**
 * The note this line's chord should open.
 *
 * The same look-back, for one line: the note where it was written if there is
 * one, and otherwise a new one beside the day being drawn. Not beside today -
 * spec §4.3 says today, and this plugin says the page, because a note made on
 * a day you are not looking at appears on a page you cannot see. The app
 * enforces the same rule from its side and would refuse any other day.
 */
planner.on('item.action', async ({ date, text }) => {
  const suffix = suffixFor(MINE, text)
  if (suffix === '') return null

  /** @type {Planner.SidecarFile[]} */
  let mine = []
  try {
    mine = await lookBack(date)
  } catch {
    // A refused capability costs you the look-back, never the note: the same
    // bargain `macos-calendar` makes with a refused calendar. The worst case
    // is a second note for a line whose first one is on an older day, and
    // both are files in your vault that ⌘F can find.
    mine = []
  }

  return { open: sidecarRef(newestFor(mine, suffix)?.date ?? date, suffix) }
})
