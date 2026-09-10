// @ts-check

/**
 * Every gesture that ends with a note open over the day: an offer pressed, a
 * search result followed, a marker clicked, a chord on a line, and a link
 * from inside another note.
 *
 * All of them navigate, any of them may make a file, and all of them then
 * have to wait - the note they want is not in the store until the day has
 * been listed and read again. So all of them end the same way, by naming the
 * suffix a later draw should open.
 *
 * Takes a `Surface` rather than reaching for `app.js`'s module state, the way
 * `vaultActions.js` takes `store` and `ipc` - nothing here reaches for
 * anything that was not handed to it, which is what makes it readable on its
 * own.
 */

import { readRef, owns } from './core/sidecars.js'
import { readActions, routeTo } from './core/actions.js'
import { openBadge } from './plugins/pageAsking.js'
import { SOMEDAY } from './core/vaultIndex.js'

/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./core/sections.js').Block} Block */
/** @typedef {import('./core/provided.js').Provided} Provided */

/**
 * The window these gestures act on.
 *
 * Getters and callbacks rather than values: the day on screen moves under
 * this module between one call and the next, and a value read at wiring time
 * would be the day the app opened on.
 *
 * @typedef {object} Surface
 * @property {Store} store
 * @property {() => string} page  the day on screen
 * @property {(date: string) => void} go  put a day on screen
 * @property {(suffix: string) => void} reveal  the note a later draw should
 *   open, once the day's files have been listed and read again
 * @property {() => void} closeSearch
 * @property {() => void} draw
 */

/**
 * Shows the note a ref names, making it if it is not there.
 *
 * The one road to a note, whichever gesture asked for it: an offer pressed, a
 * marker clicked, or a chord on a line. `routeTo` decides what the ref means
 * against the page the gesture was made on, and refuses the one case that
 * would put a file in the vault on a day nobody is looking at (spec §4.3,
 * Decision 3).
 *
 * `page` is a value, not a read. `store.readSidecar` below is a real IPC
 * round trip, not an instant call - and `surface.page()` can change while it
 * is in flight, because the person is allowed to navigate mid-gesture. That
 * is not the same thing as a plugin naming a day nobody asked about, which is
 * the only thing Decision 3 is for - so every caller captures the page once,
 * before its own await, and hands it in here rather than letting this
 * function read it live after the await above.
 *
 * `title` is the app's, never the plugin's: the plugin names the *file*, and
 * the words at the top of it are words you already wrote - a line, or an
 * offer's title. A plugin cannot write a heading into your vault. `null`
 * means this caller may never author one - a marker names a file that is
 * supposed to exist already, and if it does not, that is said rather than
 * invented.
 *
 * @param {Surface} surface
 * @param {{date: string, suffix: string}} ref
 * @param {string} page  the day the gesture was made on
 * @param {string|null} title  the first line, when the file has to be made;
 *   null when this caller must never make one
 * @returns {Promise<void>}
 */
export async function openNote(surface, ref, page, title) {
  // `store.readSidecar`, not the listing and not `store.sidecar` - both of
  // those answer the same "nothing" for "not there" and "not caught up yet",
  // and creating over the second erases someone's note. This is the one
  // definite read: null only when the file is truly not there.
  //
  // Unlike the listing, this is a bare IPC round trip with no catch of its
  // own (`sidecarStore.js`'s other read path catches; this one does not) - so
  // it is caught here. Every gesture that reaches this function `void`s it,
  // and a rejection left to become an unhandled one would mean the chord did
  // nothing and said nothing about why.
  /** @type {string|null} */
  let already
  try {
    already = await surface.store.readSidecar(ref.date, ref.suffix)
  } catch (error) {
    surface.store.notice(`Could not open that note: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const route = routeTo(ref, page, already !== null)
  if (route === null) {
    surface.store.notice(`That note belongs to ${ref.date}, and there is nothing there to open.`)
    return
  }

  if (route.create) {
    if (title === null) {
      surface.store.notice(`That note is not there yet, and this cannot start one.`)
      return
    }
    if (!await surface.store.changeSidecar(ref.date, ref.suffix, `# ${title}\n\n`)) return
  }
  if (route.go !== null) surface.go(route.go)
  // Not yet: the note is openable once the day's listing and the file's own
  // text have both caught up, which `draw` keeps trying for on every pass.
  surface.reveal(ref.suffix)
  surface.draw()
}

/**
 * Turns an offer into a note, and opens it.
 *
 * The app holds the pen: the plugin named the file, and it is created here
 * with the offered title as its first line (spec §4.1). Already there is not
 * an error - two clicks on one offer is one note.
 *
 * @param {Surface} surface
 * @param {Block} block
 * @returns {Promise<void>}
 */
export async function openSidecar(surface, block) {
  // Captured once, before `openNote`'s await: an offer's ref is always the
  // page it was pressed on, not wherever the page has drifted to by the time
  // the read resolves.
  const page = surface.page()
  await openNote(surface, { date: page, suffix: block.suffix }, page, block.title)
}

/**
 * Goes where a provider's hit points.
 *
 * A date jumps to that day, exactly as a vault hit does. A `sidecar:` href
 * then opens the note - which may take a draw or two, because the day it
 * names has to be listed and the file read (spec §4.3).
 *
 * @param {Surface} surface
 * @param {Provided} hit
 * @returns {Promise<void>}
 */
export async function followHit(surface, hit) {
  const named = hit.href === null ? null : readRef(hit.href)
  const page = named?.date ?? hit.date
  if (page === null) return

  surface.go(page)
  surface.closeSearch()
  if (named !== null) surface.reveal(named.suffix)
  surface.draw()
}

/**
 * A `sidecar:` link inside a note, followed (spec §2.3).
 *
 * The same road as every other gesture, and deliberately not a second
 * resolver: `openNote` decides what the ref means against the day the note is
 * open on, and the draw loop opens whatever it names.
 *
 * No prefix check, unlike `openMarker` below. That list says which files a
 * *plugin* may name, and this link is not a plugin's - you typed it into your
 * own note. `title` is null all the same: a link is not an invitation to
 * create the file it points at, so a ref naming a note that is not there gets
 * the notice `openNote` gives every other caller that may not author one.
 *
 * @param {Surface} surface
 * @param {string} href
 * @returns {Promise<void>}
 */
export async function followRef(surface, href) {
  // Captured once, before `openNote`'s await: the link was in a note open on
  // this page, whatever the page has moved to by the time the read resolves.
  const page = surface.page()
  const ref = readRef(href)
  if (ref === null) return
  await openNote(surface, ref, page, null)
}

/**
 * A page of your own about the line holding the caret (spec §4.3).
 *
 * Asks the one plugin approved for `item.action` and opens what it names.
 * With none, the chord does nothing - there is nothing to do, and a notice
 * about a plugin you have not installed is noise. With more than one it says
 * so and opens nothing: spec §4.3 puts a pick list under the line for that
 * case and this version does not draw one (Decision 2), and picking for you
 * would be picking by name order, which is not a decision anybody made.
 *
 * @param {Surface} surface
 * @param {{index: number, text: string}} line
 * @returns {Promise<void>}
 */
export async function noteOnLine(surface, line) {
  // Captured once, at the top, before `askOnce`'s await - which carries a
  // two second deadline, the widest window any of these gestures leaves open.
  // Without this the question below could name Friday while the page has
  // moved on to Monday by the time the plugin answers, and `openNote` would
  // judge the answer against a day it was never asked about.
  const page = surface.page()

  // `item.action`'s `date` is a day a note can be made or found on - every
  // plugin's look-back, and `routeTo` below, both read it as `YYYY-MM-DD`.
  // The back page is reachable here (a search hit can land showing on it, spec
  // §5.7) and is not a date, so there is nothing to ask about: silence, the
  // same silence as pressing the chord with no action plugin installed.
  if (page === SOMEDAY) return

  const acting = surface.store.installed()
    .filter((one) => one.enabled && one.approvedSlots.includes('item.action'))

  if (acting.length === 0) return
  if (acting.length > 1) {
    const names = acting.map((one) => one.name).join(' and ')
    surface.store.notice(`${names} both offer a note for a line, and this version can only ask one. Untick one of them in the settings.`)
    return
  }

  /** @type {{answers: {plugin: string, value: unknown}[], notices: string[]}} */
  let given
  try {
    given = await surface.store.askOnce('item.action', {
      date: page,
      index: line.index,
      text: line.text,
    })
  } catch (error) {
    surface.store.notice(`Could not ask about that line: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  for (const notice of given.notices) surface.store.notice(notice)

  const { openings, notices } = readActions(given.answers, surface.store.pluginPrefixes())
  for (const notice of notices) surface.store.notice(notice)

  const opening = openings[0]
  // A plugin with nothing to say about this line. Not an error, and not worth
  // a sentence: you pressed a chord and nothing happened, which is what
  // "there is no note here and none to be made" looks like.
  if (opening === undefined) return

  // The line's own words are the heading, because they are the thing this
  // note is about and you wrote them.
  await openNote(surface, opening, page, line.text)
}

/**
 * A marker pressed: a note of the plugin's, or an address it may open.
 *
 * `item.badge` hands back an `href` and the app decides what it is. A
 * `sidecar:` ref is a file, and is checked against the prefixes the answering
 * plugin owns before anything is done with it - spec §4.1 says every such
 * href, from any slot, is checked that way, and until now the badge slot was
 * the one that did not. Anything else is an address, and goes the way it
 * always has: past `mayOpen`, and out through the shell.
 *
 * A marker names a file that is supposed to exist already, but `core/badges.js`
 * does not require that of the href it hands back - whether it may be opened
 * is not that reader's question, or this one's to answer by inventing a file.
 * So `openNote` is told never to create one here: a marker that turns out to
 * point at nothing gets a notice, not a note titled after a raw suffix.
 *
 * @param {Surface} surface
 * @param {string} plugin  who answered, which decides what it may name
 * @param {string} href
 * @returns {Promise<void>}
 */
export async function openMarker(surface, plugin, href) {
  // Captured once, before `openNote`'s await: the marker was clicked on this
  // page, whatever the page has moved to by the time the read resolves.
  const page = surface.page()
  const ref = readRef(href)
  if (ref === null) {
    await openBadge(surface.store, plugin, href)
    return
  }

  const prefixes = surface.store.pluginPrefixes().get(plugin) ?? []
  if (!owns(prefixes, ref.suffix)) {
    surface.store.notice(`${plugin} pointed at a note that is not one of its own.`)
    return
  }

  await openNote(surface, ref, page, null)
}
