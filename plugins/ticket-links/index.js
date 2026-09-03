// @ts-check

/**
 * ticket-links — turns `#4412` on a line into a marker that opens the pull
 * request.
 *
 * Written against the public API and nothing else. It is shown the text of
 * every line on the page being drawn and answers with a marker for the ones
 * that mention a ticket; it never calls anything when the marker is clicked,
 * because the click belongs to the app.
 *
 * The pattern and the address are constants here. Both become settings you can
 * type into the ⌘, pane in the next version, at which point this file reads
 * `planner.settings` instead.
 */

/** The ticket a line mentions. Anchored to a word boundary so `x#1` is not one. */
const PATTERN = /(?:^|\s)#(\d+)\b/

/** Where a ticket lives. `$1` is the number the pattern found. */
const ADDRESS = 'https://github.com/gotab-inc/node/pull/$1'

planner.on('item.badge', ({ items }) =>
  items.flatMap((item) => {
    const found = PATTERN.exec(item.text)
    const number = found?.[1]
    if (number === undefined) return []
    return [{
      index: item.index,
      label: `#${number}`,
      href: ADDRESS.replace('$1', encodeURIComponent(number)),
    }]
  }),
)
