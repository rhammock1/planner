// @ts-check

/**
 * ticket-links — turns a ticket mention on a line into a marker that opens
 * it.
 *
 * Written against the public API and nothing else. It is shown the text of
 * every line on the page being drawn and answers with a marker for the ones
 * that mention a ticket; it never calls anything when the marker is clicked,
 * because the click belongs to the app.
 *
 * The pattern and the URL are settings rather than constants: a person whose
 * tickets are not on the author's host can still use this plugin, because the
 * address is theirs, typed into the pane, and typing it is the approval
 * (spec §2.1).
 */

/**
 * The pattern, as the person wrote it.
 *
 * Built once rather than per line. A pattern that will not compile is the
 * person's typo, and it costs a notice on the page rather than an exception
 * for every line on it.
 *
 * The expression itself runs in this plugin's own webview under this plugin's
 * own two-second deadline, so a pathological one costs this plugin its
 * session and nothing else.
 */
const pattern = compile(String(planner.settings.pattern ?? ''))
const address = String(planner.settings.url ?? '')

planner.on('item.badge', ({ items }) => {
  if (pattern === null) throw new Error('the ticket pattern is not a regular expression')
  if (address === '') throw new Error('no ticket URL has been set')

  return items.flatMap((item) => {
    const found = pattern.exec(item.text)
    const captured = found?.[1] ?? found?.[0]
    if (captured === undefined) return []
    return [{
      index: item.index,
      label: captured.startsWith('#') ? captured : `#${captured}`,
      href: address.replace('$1', encodeURIComponent(captured)),
    }]
  })
})

/**
 * @param {string} source
 * @returns {RegExp|null}
 */
function compile(source) {
  try {
    return source === '' ? null : new RegExp(source)
  } catch {
    return null
  }
}
