// @ts-check

/**
 * The two places the app reaches outside itself for a file or a folder: the
 * day being shown, opened in the user's own editor, and a vault folder to
 * open (spec §8).
 *
 * Takes `store` and `ipc` as arguments, the way `pageAsking.js` does, so this
 * module has no hidden coupling to `app.js` - nothing here reaches for
 * module state that was not handed to it.
 */

/** @typedef {import('./store.js').Store} Store */
/** @typedef {typeof import('./ipc.js')} Ipc */

/**
 * Opens the day being shown in the user's own editor (spec §8).
 *
 * The page being shown, not today: if there is something in Friday's file
 * this app has misread, Friday is the file to open.
 *
 * @param {Store} store
 * @param {Ipc} ipc
 * @param {string} page  the page on screen
 * @returns {Promise<void>}
 */
export async function openInEditor(store, ipc, page) {
  try {
    const path = await ipc.pagePath(page)
    if (path === null) {
      store.notice('There is no vault open to find that page in.')
      return
    }
    if (store.page(page) === null) {
      // Nothing has been written on this day, so there is no file. The app
      // does not make one until there is something to put in it (spec §3.1).
      store.notice(`Nothing has been written on ${page} yet, so there is no file to open.`)
      return
    }
    await ipc.openInEditor(path, store.config().editor)
  } catch (error) {
    store.notice(`Could not open the file: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Asks for a folder to keep the vault in, and writes it down (spec §8).
 *
 * Dismissing the dialog is an answer - not now - so it leaves everything as
 * it was rather than saying anything.
 *
 * @param {Store} store
 * @param {Ipc} ipc
 * @returns {Promise<void>}
 */
export async function pickVault(store, ipc) {
  try {
    const path = await ipc.chooseVault()
    if (path === null) return
    await store.saveConfig({ vault: path })
  } catch (error) {
    store.notice(`Could not use that folder: ${error instanceof Error ? error.message : String(error)}`)
  }
}
