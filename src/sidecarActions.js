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

import { readRef } from './core/sidecars.js'

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
  const page = surface.page()
  // `store.readSidecar`, not the listing and not `store.sidecar` - both of
  // those answer the same "nothing" for "not there" and "not caught up yet",
  // and creating over the second erases someone's note. This is the one
  // definite read: null only when the file is truly not there.
  const already = await surface.store.readSidecar(page, block.suffix)
  if (already === null && !await surface.store.changeSidecar(page, block.suffix, `# ${block.title}\n\n`)) return
  // Not yet: the block exists once the listing and the plugin both catch up,
  // which `draw` keeps trying for on every pass.
  surface.reveal(block.suffix)
  surface.draw()
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
