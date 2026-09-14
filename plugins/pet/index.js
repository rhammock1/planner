// @ts-check

/**
 * `pet` - a creature in the day's margin that reacts to how the day is going.
 *
 * The fourth reference plugin, and the one that leans on four walls at once:
 * a box it cannot leave, `planner.storage`, counts rather than words, and a
 * question it is asked on every draw. Everything it is told is four integers
 * and five colours. It is never told what a single line says, it cannot be
 * clicked, and it reaches nothing but its own file.
 *
 * The decision lives in `mood.js` and the drawing in `draw.js`, both pure and
 * both tested under `node --test`. What is left here is the wiring, which is
 * the part that cannot be tested without a host.
 */

import { moodOf, remembered, streak, deepening } from './mood.js'
import { petSvg } from './draw.js'

/** Where the week lives in this plugin's own file. */
const HISTORY = 'history'

planner.on('page.box', async (question) => ({
  svg: petSvg({
    mood: moodOf(question.glance),
    deep: await deep(question),
    theme: question.theme,
  }),
}))

/**
 * How far into a streak of this mood today is, as 0 to 1.
 *
 * Three things are true here and each one costs a line.
 *
 * The history is only touched when the page being drawn *is* today. Flipping
 * back through last week must not rewrite what last week was: `date` is the
 * page, `now.date` is the day, and they are the same thing only sometimes.
 * On any other page the creature draws what that page says and nothing more,
 * which is the honest answer - this plugin has no history of a day it is
 * looking at rather than living through.
 *
 * Storage is awaited but never required. A creature that refuses to appear
 * because a file would not open is worse than one that has forgotten the
 * week, so every failure here ends in 0 and a drawing.
 *
 * And the file is only written when it would change. `page.box` is asked
 * again every time the day's counts move, which on a busy morning is often;
 * the guard is what keeps a doodle from being a write amplifier.
 *
 * @param {Planner.BoxQuestion} question
 * @returns {Promise<number>}
 */
async function deep(question) {
  if (question.date !== question.now.date) return 0

  try {
    const stored = await planner.storage.get(HISTORY)
    const history = remembered(stored, question.date, question.glance)
    if (JSON.stringify(stored) !== JSON.stringify(history)) {
      await planner.storage.set(HISTORY, history)
    }
    return deepening(streak(history))
  } catch (error) {
    // Said once, where a plugin author will see it. Not on the page: the
    // margin has no words in it, which is the point of the slot.
    console.warn('pet could not read its own history', error)
    return 0
  }
}
