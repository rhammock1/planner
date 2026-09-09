// @ts-check

/**
 * The two gestures that end with a caret in a block: an offer pressed, and a
 * search result followed.
 *
 * Both of them navigate, both of them may make a file, and both of them then
 * have to wait - the block they want does not exist until the day has been
 * listed and its plugin asked again. So both end the same way, by naming the
 * suffix a later draw should reveal.
 *
 * Takes a `Surface` rather than reaching for `app.js`'s module state, the way
 * `vaultActions.js` takes `store` and `ipc` - nothing here reaches for
 * anything that was not handed to it, which is what makes it readable on its
 * own.
 */

import { readRef, owns } from './core/sidecars.js'
import { readActions, routeTo } from './core/actions.js'
import { openBadge } from './plugins/pageAsking.js'

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
 * @property {(suffix: string) => void} reveal  the block a later draw should
 *   put the caret in, once the plugin has answered about it again
 * @property {() => void} closeSearch
 * @property {() => void} draw
 */

/**
 * Shows the note a ref names, making it if it is not there.
 *
 * The one road to a note, whichever gesture asked for it: an offer pressed, a
 * marker clicked, or a chord on a line. `routeTo` decides what the ref means
 * against the page on screen, and refuses the one case that would put a file
 * in the vault on a day nobody is looking at (spec §4.3, Decision 3).
 *
 * `title` is the app's, never the plugin's: the plugin names the *file*, and
 * the words at the top of it are words you already wrote - a line, or an
 * offer's title. A plugin cannot write a heading into your vault.
 *
 * @param {Surface} surface
 * @param {{date: string, suffix: string}} ref
 * @param {string} title  the first line, when the file has to be made
 * @returns {Promise<void>}
 */
export async function openNote(surface, ref, title) {
  // `store.readSidecar`, not the listing and not `store.sidecar` - both of
  // those answer the same "nothing" for "not there" and "not caught up yet",
  // and creating over the second erases someone's note. This is the one
  // definite read: null only when the file is truly not there.
  const already = await surface.store.readSidecar(ref.date, ref.suffix)
  const route = routeTo(ref, surface.page(), already !== null)
  if (route === null) {
    surface.store.notice(`That note belongs to ${ref.date}, and there is nothing there to open.`)
    return
  }

  if (route.create && !await surface.store.changeSidecar(ref.date, ref.suffix, `# ${title}\n\n`)) return
  if (route.go !== null) surface.go(route.go)
  // Not yet: the block exists once the listing and the plugin both catch up,
  // which `draw` keeps trying for on every pass.
  surface.reveal(ref.suffix)
  surface.draw()
}

/**
 * Turns an offer into a note, and puts the caret in it.
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
  await openNote(surface, { date: surface.page(), suffix: block.suffix }, block.title)
}

/**
 * Goes where a provider's hit points.
 *
 * A date jumps to that day, exactly as a vault hit does. A `sidecar:` href
 * then puts the caret in the block - which may take a draw or two, because
 * the day it names has to be listed and its plugin asked (spec §4.3).
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
      date: surface.page(),
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
  await openNote(surface, opening, line.text)
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
 * @param {Surface} surface
 * @param {string} plugin  who answered, which decides what it may name
 * @param {string} href
 * @returns {Promise<void>}
 */
export async function openMarker(surface, plugin, href) {
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

  // The suffix stands in for a title that is never written: a marker exists
  // only because a file does, and `routeTo` refuses the case where it does
  // not - so `openNote` never reaches the branch that would use this.
  await openNote(surface, ref, ref.suffix)
}
