// @ts-check

/**
 * Files beside a day: what each says, and how a change to one reaches disk.
 *
 * `src/core/sidecars.js` is the rule - what a suffix may be, what a path looks
 * like, who owns which prefix. This is a different thing: what a window is
 * *holding* - the caches, the in-flight reads, the write queue and the
 * subscription that keep a block's answer to "what does this sidecar say"
 * both cheap and current.
 *
 * Its own file because the store was over three hundred lines and this is the
 * part of it that is not about the day index.
 */

import { createWriteQueue } from './writeQueue.js'
import { sidecarRef, readRef } from './core/sidecars.js'
import * as ipc from './ipc.js'

/**
 * @typedef {object} SidecarDeps
 * @property {() => void} onChanged  redraw: a read landed, or a write did
 * @property {(line: string) => void} notice  a line for the page's notice band
 */

/**
 * @typedef {object} Sidecars
 * @property {() => Promise<void>} start  subscribes to the watcher; rejects if it cannot
 * @property {() => void} reopen  the vault moved, so nothing held is about it any more
 * @property {(date: string, suffix: string) => string|null} text
 * @property {(date: string) => {suffix: string, title: string}[]} on
 * @property {(date: string, suffix: string, text: string) => Promise<boolean>} change
 */

/**
 * @param {SidecarDeps} deps
 * @returns {Sidecars}
 */
export function createSidecars(deps) {
  // The same hazard over a different document. A block on the day page is a
  // window onto a file, exactly as the page is a window onto the day, so the
  // text takes the same route: mutate, queue, write, watcher, re-read.
  const sidecarWrites = createWriteQueue(
    /** @type {(key: string, text: string) => Promise<void>} */
    (async (key, text) => {
      const named = readRefOrThrow(key)
      await ipc.writeSidecar(named.date, named.suffix, text)
    }),
  )

  /** What each sidecar says on disk, by `sidecar:<date>/<suffix>`. Null for a
   *  file that is not there, which is how a block tells "no note yet" from
   *  "an empty note". @type {Map<string, string|null>} */
  let sidecarText = new Map()
  /** Reads in the air, so a draw does not ask the same question twice.
   *  @type {Set<string>} */
  const sidecarReading = new Set()
  /** Which sidecars exist on a day, by date. @type {Map<string, {suffix: string, title: string}[]>} */
  let sidecarsByDay = new Map()
  /** @type {Set<string>} */
  const listing = new Set()

  return {
    async start() {
      await ipc.onSidecarChanged(async ({ date, suffix }) => {
        const key = sidecarRef(date, suffix)
        sidecarText.set(key, await ipc.readSidecar(date, suffix))
        // Whatever we may have written to this file has now arrived, so the
        // file is the only thing worth believing about it.
        sidecarWrites.observed(key)
        // The day's listing is now a day older than the truth: a note that
        // has just been created is not in it.
        sidecarsByDay.delete(date)
        deps.onChanged()
      })
    },

    /**
     * The vault moved, so nothing held here is about it any more.
     *
     * The two in-flight sets are cleared as well as the two caches, and that
     * is the part worth saying out loud: a read that was in the air when the
     * vault changed resolves into the maps that are here *now*, and would
     * otherwise file the old vault's note under the new vault's name.
     */
    reopen: () => {
      sidecarText = new Map()
      sidecarsByDay = new Map()
      sidecarReading.clear()
      listing.clear()
    },

    /**
     * What a sidecar says, asking if nobody has (spec §1.4's draw-on-miss,
     * applied to a file rather than to a plugin's answer).
     *
     * Null means "not read yet, or not there" - a block draws empty either
     * way, and is redrawn when the read lands.
     */
    text: (date, suffix) => {
      const key = sidecarRef(date, suffix)
      const held = sidecarWrites.current(key, () => sidecarText.get(key) ?? null)
      if (sidecarText.has(key) || sidecarReading.has(key)) return held

      sidecarReading.add(key)
      void ipc.readSidecar(date, suffix)
        .then((text) => { sidecarText.set(key, text) })
        .catch((error) => {
          sidecarText.set(key, null)
          deps.notice(`Could not read ${date}.${suffix}: ${message(error)}`)
        })
        .finally(() => {
          sidecarReading.delete(key)
          deps.onChanged()
        })
      return held
    },

    /**
     * Which sidecars exist on a day. Asked once per day and re-asked when one
     * of that day's files changes.
     */
    on: (date) => {
      const have = sidecarsByDay.get(date)
      if (have !== undefined) return have
      if (listing.has(date)) return []

      listing.add(date)
      void ipc.listSidecars(date, date)
        .then((found) => {
          sidecarsByDay.set(date, found.map((one) => ({ suffix: one.suffix, title: one.title })))
        })
        .catch((error) => {
          sidecarsByDay.set(date, [])
          deps.notice(`Could not list the notes on ${date}: ${message(error)}`)
        })
        .finally(() => {
          listing.delete(date)
          deps.onChanged()
        })
      return []
    },

    /**
     * The one place a sidecar leaves the app. Nothing else writes one, and no
     * plugin ever does (spec §4.1).
     */
    change: async (date, suffix, text) => {
      const key = sidecarRef(date, suffix)
      try {
        return await sidecarWrites.change(key, () => sidecarText.get(key) ?? null, () => text)
      } catch (error) {
        deps.notice(`Could not save ${date}.${suffix}: ${message(error)}`)
        deps.onChanged()
        return false
      }
    },
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The day and suffix a queue key names.
 *
 * Throws rather than returns null: every key in that queue was built by
 * `sidecarRef` from a date and a suffix this module had already checked, so a
 * key that will not parse is this file's own bug and not a plugin's.
 *
 * @param {string} key
 * @returns {{date: string, suffix: string}}
 */
function readRefOrThrow(key) {
  const named = readRef(key)
  if (named === null) throw new Error(`${key} is not a sidecar`)
  return named
}
