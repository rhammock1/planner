// @ts-check

/**
 * What the app says while nobody is looking at it.
 *
 * Two things, and they have the same shape: work out from the vault what the
 * shell should be holding, and hand it over only when it differs from what the
 * shell is already holding. The menu bar icon's label (spec §5.8) and the
 * alarms for today's timed lines (spec §5.9).
 *
 * Both are about today and never about the day being shown. Flipping back to
 * last Tuesday is reading; the icon and the alarms are about what is owed now.
 */

import { glance, badge } from './core/glance.js'
import { schedule, upcoming } from './core/schedule.js'
import { instantAt } from './clock.js'
import * as ipc from './ipc.js'

/** @typedef {import('./store.js').Store} Store */

/**
 * @param {Store} store
 * @returns {{update: (today: string) => void}}
 */
export function createAmbient(store) {
  /** What the icon is already carrying. `undefined` means nothing has been
   *  sent yet, which is not the same as a bare icon.
   *  @type {string|null|undefined} */
  let labelled
  /** The schedule the shell is already holding. @type {string|undefined} */
  let scheduled
  /** Said once each. A shell that will not take these is worth one line, not
   *  one line per redraw. @type {Set<string>} */
  const said = new Set()

  /**
   * @param {string} what
   * @param {unknown} error
   * @returns {void}
   */
  function report(what, error) {
    if (said.has(what)) return
    said.add(what)
    store.notice(`${what}: ${error instanceof Error ? error.message : String(error)}`)
  }

  /**
   * @param {string} today `YYYY-MM-DD`
   * @returns {void}
   */
  function label(today) {
    const config = store.config()
    const text = badge(glance(store.vault(), today, config.horizonLeadDays), {
      count: config.menuBarCount,
      dot: config.menuBarHorizonDot,
    })
    if (text === labelled) return
    labelled = text

    void ipc.setBadge(text).catch((error) => {
      report('The menu bar icon will not show what is left', error)
    })
  }

  /**
   * Hands the shell every alarm today still owes, complete.
   *
   * @param {string} today `YYYY-MM-DD`
   * @returns {void}
   */
  function alarms(today) {
    const owed = upcoming(
      schedule(store.vault(), today),
      (time) => instantAt(today, time),
      Date.now(),
    )

    const sending = JSON.stringify(owed)
    if (sending === scheduled) return
    scheduled = sending

    void ipc.setNotifications(owed).catch((error) => {
      report('Timed lines will not be announced', error)
    })
  }

  return {
    update: (today) => {
      label(today)
      alarms(today)
    },
  }
}
