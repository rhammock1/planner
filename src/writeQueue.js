// @ts-check

/**
 * Runs one change at a time, and remembers what has been written but not yet
 * read back.
 *
 * Every edit round-trips through the filesystem (spec §4.1), so there is a
 * window between writing a page and seeing it again. Two clicks inside that
 * window both read the page as it was before either of them, and the second
 * write throws the first one away - a checkbox that unticks itself, or worse,
 * a different line quietly reverting.
 *
 * The fix is not to keep a copy of the vault in memory. It is to keep, for
 * exactly as long as a write is outstanding, the document that was sent - and
 * to drop it the moment that page arrives from disk. Disk stays the truth;
 * this is only the part of the truth that has not finished travelling.
 *
 * Generic over what a key's document *is*. A page's is a `Document` and a
 * sidecar's is a string of free text (spec §4.1), and the hazard is the same
 * for both: two edits inside one round trip, the second reading the file as
 * it was before either of them. One queue per kind, because a queue over the
 * union of the two would make every caller narrow a type it already knows.
 */

/** @typedef {import('./core/model.js').Document} Document */

/**
 * @template T  what one key's document is: a `Document` for a page, a string
 *   for a sidecar (spec §4.1)
 * @typedef {object} WriteQueue
 * @property {(key: string, readDisk: () => T|null, mutate: (doc: T|null) => T|null) => Promise<boolean>} change
 * @property {(key: string, readDisk: () => T|null) => T|null} current
 * @property {(key: string) => void} observed
 */

/**
 * @template T
 * @param {(key: string, doc: T) => Promise<void>} write
 * @returns {WriteQueue<T>}
 */
export function createWriteQueue(write) {
  /** @type {Map<string, T>} */
  const inFlight = new Map()

  /** @type {Promise<void>} */
  let tail = Promise.resolve()

  return {
    /**
     * `readDisk` is called when the change runs, not when it is queued, so a
     * change waiting its turn still sees whatever landed in the meantime.
     * `mutate` returns null to write nothing.
     */
    change: (key, readDisk, mutate) => {
      const result = tail.then(async () => {
        const next = mutate(inFlight.get(key) ?? readDisk())
        if (next === null) return false

        inFlight.set(key, next)
        try {
          await write(key, next)
          return true
        } catch (error) {
          // The write failed, so the file still says what it said. Forget the
          // document that never landed, or every later change builds on it.
          inFlight.delete(key)
          throw error
        }
      })

      // The queue carries on after a failure: one refused write must not stop
      // the next thing the user does.
      tail = result.then(() => undefined, () => undefined)
      return result
    },

    /**
     * The freshest version of a page: what was last written if it has not
     * come back yet, otherwise what is on disk. For a caller that has to
     * reason about several pages at once before deciding what to write.
     */
    current: (key, readDisk) => inFlight.get(key) ?? readDisk(),

    observed: (key) => { inFlight.delete(key) },
  }
}
