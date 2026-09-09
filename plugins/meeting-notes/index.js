// @ts-check

/**
 * The notes kept beside a day, listed under it.
 *
 * Version 0.0.1, and deliberately the smallest thing that uses
 * `vault.sidecar.read` for something a person would want. It grows into the
 * plugin of spec §4.2 - a block per meeting, typed into on the page - once
 * `page.section` exists. Until then it reads and it says what it read, which
 * is enough to prove the capability is the right shape.
 *
 * A reference plugin, and the design's own test: written against the public
 * API with no privilege the API does not grant. Note what it cannot do. It
 * cannot see a note whose name does not begin with `meeting`, because the
 * prefix in its manifest is the whole of what it owns. It cannot write one.
 * It cannot ask which files exist except by asking for a range of days.
 */

/** How many notes are worth a line under one day. More than this and the
 *  section is longer than the list it sits under. */
const MOST = 6

/** The longest a note's own words may be on a contributed line. A line under
 *  the day is a reminder that the note is there, not the note. */
const LONGEST = 60

planner.onContribute(async ({ from, to }) => {
  const notes = planner.capability('vault.sidecar.read')

  // One call for the whole range, never one per day: the host asks for a
  // range precisely so this is not sixty calls (spec §4.1).
  const mine = await notes.list({ from, to })

  /** @type {{date: string, time: null, text: string}[]} */
  const lines = []

  for (const one of mine.slice(0, MOST)) {
    let opening = ''
    try {
      opening = firstWords(await notes.read(one.date, one.suffix))
    } catch {
      // Deleted since the listing, or no longer ours because the ticks
      // changed while this was in flight. Neither is worth a line saying so;
      // the title is still worth showing.
    }

    lines.push({
      date: one.date,
      // A note is not an appointment. It happened at no particular hour and
      // sorts with the all-day things, which is where it belongs.
      time: null,
      text: opening === '' ? one.title : `${one.title} — ${opening}`,
    })
  }

  return lines
})

/**
 * The first line of a note that is not its heading, cut.
 *
 * `# Standup\n\nDaryoush wants the retry to back off` reads back as
 * `Daryoush wants the retry to back off`, and a note with only a heading
 * reads back as nothing at all.
 *
 * @param {string} text
 * @returns {string}
 */
function firstWords(text) {
  const line = text
    .split('\n')
    .map((one) => one.trim())
    .find((one) => one !== '' && !one.startsWith('#'))

  if (line === undefined) return ''
  return line.length <= LONGEST ? line : `${line.slice(0, LONGEST - 1)}…`
}
