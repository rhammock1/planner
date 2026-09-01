// @ts-check

/**
 * The day's events, from the calendars this Mac already has.
 *
 * A reference plugin, and the design's own test: it is written against the
 * public API with no privilege the API does not grant, and if it could not
 * be, the API would be wrong (spec §7.5).
 *
 * Note how little there is. Everything native happens on the other side of
 * `capability`; everything about timezones happened before the events got
 * here. What is left is the one decision this plugin makes, which is which
 * events are worth a line on a planner page.
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
