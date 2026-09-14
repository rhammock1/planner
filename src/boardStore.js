// @ts-check

/**
 * The files a plugin keeps in its own folder of the vault: what each says, and
 * how a change to one reaches disk (spec §2.5).
 *
 * `src/core/plugins.js` is the rule about the folder's name and
 * `src/core/board.js` is the slot. This is the third thing, the one
 * `sidecarStore.js` is for its own kind of file: what a *window* is holding -
 * the cache, the read in flight, the queue that keeps two drags inside one
 * round trip from throwing each other away.
 *
 * One difference from a sidecar, and everything else here follows from it.
 * Nothing announces these files. `page_for_path` refuses every path under a
 * plugin's folder, so the watcher never sees one change and there is no
 * `board:changed` to subscribe to - which means a write is the only news of a
 * write there will ever be, and this module records its own. The cost is a
 * board edited in an editor while the window is open: it is stale until the
 * vault is reopened. That is the bargain §2.5 makes for keeping a board out of
 * the day view, out of ⌘F, and out of the watcher's way.
 */

import { createWriteQueue } from './writeQueue.js'
import { vaultFolder } from './core/plugins.js'
import { isSuffix } from './core/sidecars.js'
import * as ipc from './ipc.js'

/**
 * @typedef {object} BoardDeps
 * @property {() => void} onChanged  redraw: a read landed, or a write did
 * @property {(line: string) => void} notice  a line for the window's notice band
 */

/**
 * @typedef {object} Boards
 * @property {() => void} reopen  the vault moved, so nothing held is about it any more
 * @property {(name: string, file: string) => string|null} text
 * @property {(name: string, file: string, text: string) => Promise<boolean>} change
 */

/**
 * @param {BoardDeps} deps
 * @returns {Boards}
 */
export function createBoards(deps) {
  /** What each file says on disk, by `<name>/<file>`. Null for a file that is
   *  not there, which is how a tab tells "no board yet" from "a board somebody
   *  emptied". @type {Map<string, string|null>} */
  let boardText = new Map()
  /** Reads in the air, so a draw does not ask the same question twice.
   *  @type {Set<string>} */
  const reading = new Set()

  /** @type {import('./writeQueue.js').WriteQueue<string>} */
  let writes
  writes = createWriteQueue(
    /** @type {(key: string, text: string) => Promise<void>} */
    (async (key, text) => {
      const named = readRefOrThrow(key)
      await ipc.writePluginFile(named.name, named.file, text)
      // Where a sidecar would now wait for the watcher to hand the file back,
      // this records the landing itself: there is no event coming, so a queue
      // still holding this text would hold it for the life of the window and
      // mask anything read later.
      boardText.set(key, text)
      writes.observed(key)
    }),
  )

  return {
    /**
     * The vault moved, so nothing held here is about it any more - including
     * the read that was in the air, which would otherwise file the old
     * vault's board under the new vault's name.
     */
    reopen: () => {
      boardText = new Map()
      reading.clear()
    },

    /**
     * What one of a plugin's files says, asking if nobody has (spec §1.4's
     * draw-on-miss, applied to a file rather than to a plugin's answer).
     *
     * Null means "not read yet, or not there". A board draws from its file, so
     * either way the first draw is the empty board and the second - once the
     * read lands and `onChanged` fires - is the real one.
     */
    text: (name, file) => {
      const key = boardRef(name, file)
      if (key === null) return null
      const held = writes.current(key, () => boardText.get(key) ?? null)
      if (boardText.has(key) || reading.has(key)) return held

      reading.add(key)
      void ipc.readPluginFile(name, file)
        .then((text) => { boardText.set(key, text) })
        .catch((error) => {
          boardText.set(key, null)
          deps.notice(`Could not read ${name}/${file}: ${message(error)}`)
        })
        .finally(() => {
          reading.delete(key)
          deps.onChanged()
        })
      return held
    },

    /**
     * The one place a plugin's file leaves the app. The plugin proposes a
     * board; the app holds the pen, exactly as it does for a sidecar
     * (spec §2.5, §4.1).
     */
    change: async (name, file, text) => {
      const key = boardRef(name, file)
      if (key === null) {
        deps.notice(`${name}/${file} is not a file a plugin may keep in the vault.`)
        return false
      }
      try {
        return await writes.change(key, () => boardText.get(key) ?? null, () => text)
      } catch (error) {
        deps.notice(`Could not save ${name}/${file}: ${message(error)}`)
        deps.onChanged()
        return false
      }
    },
  }
}

/**
 * The key one of a plugin's files is held under, or null if it is not one.
 *
 * Checked here as well as in Rust, and by the same two rules: `vaultFolder`
 * for the folder and `isSuffix` for the file, which is the rule `folders.rs`
 * reuses on that side for the same reason. Not because this is the boundary -
 * `folders.rs` is - but because a cache key that could hold a `/` is a cache
 * two files would share.
 *
 * @param {string} name
 * @param {string} file
 * @returns {string|null}
 */
function boardRef(name, file) {
  if (vaultFolder(name) === null || !isSuffix(file)) return null
  return `${name}/${file}`
}

/**
 * The plugin and file a queue key names.
 *
 * Throws rather than returns null, for `sidecarStore.js`'s reason: every key
 * in that queue came from `boardRef`, which had already checked both halves,
 * so a key that will not parse is this file's own bug and not a plugin's.
 *
 * @param {string} key
 * @returns {{name: string, file: string}}
 */
function readRefOrThrow(key) {
  const [name = '', file = ''] = key.split('/')
  if (boardRef(name, file) !== key) throw new Error(`${key} is not a plugin's file`)
  return { name, file }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
