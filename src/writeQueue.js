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
 */

/** @typedef {import('./core/model.js').Document} Document */

/**
 * @typedef {object} WriteQueue
 * @property {(page: string, readDisk: () => Document|null, mutate: (doc: Document|null) => Document|null) => Promise<boolean>} change
 * @property {(page: string, readDisk: () => Document|null) => Document|null} current
 * @property {(page: string) => void} observed
 */

/**
 * @param {(page: string, doc: Document) => Promise<void>} write
 * @returns {WriteQueue}
 */
export function createWriteQueue(write) {
  /** @type {Map<string, Document>} */
  const inFlight = new Map()

  /** @type {Promise<void>} */
  let tail = Promise.resolve()

  return {
    /**
     * `readDisk` is called when the change runs, not when it is queued, so a
     * change waiting its turn still sees whatever landed in the meantime.
     * `mutate` returns null to write nothing.
     */
    change: (page, readDisk, mutate) => {
      const result = tail.then(async () => {
        const next = mutate(inFlight.get(page) ?? readDisk())
        if (next === null) return false

        inFlight.set(page, next)
        try {
          await write(page, next)
          return true
        } catch (error) {
          // The write failed, so the file still says what it said. Forget the
          // document that never landed, or every later change builds on it.
          inFlight.delete(page)
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
    current: (page, readDisk) => inFlight.get(page) ?? readDisk(),

    observed: (page) => { inFlight.delete(page) },
  }
}
