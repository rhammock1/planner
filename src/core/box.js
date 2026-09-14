// @ts-check

/**
 * `page.box`: the small picture a plugin draws in the day's margin (spec §5.1,
 * phase four §1.1).
 *
 * The box sits at the right-hand end of the day's note row, with the note
 * taking the rest of it - the corner of the page a notebook gets doodled in.
 * What comes back is a picture and nothing else: the plugin is handed four
 * counts and the paper's colours, and returns SVG. It cannot be clicked, it
 * cannot ask anything, and it is never told what any line says.
 *
 * That trade is the point rather than a limitation worked around. A picture
 * cannot be clicked, and a doodle in a margin is looked at.
 *
 * Pure: the answer is read here and drawn elsewhere, so a picture is a string
 * by the time any view has it.
 */

import { readPicture } from './picture.js'
import { optionNumber, slotOptions } from './manifest.js'

/** @typedef {import('./manifest.js').Manifest} Manifest */
/** @typedef {import('./glance.js').DayGlance} DayGlance */
/** @typedef {import('./picture.js').Picture} Picture */

/**
 * What the margin is, when a plugin does not say otherwise.
 *
 * 48 rather than the 64 the phases spec first wrote down. Measured against the
 * real page at both window widths: 48 costs the list about 20px where 64 costs
 * it 36, and it still reads as a creature at the size it is drawn. 64 was a
 * round number in a spec, not a measurement.
 */
export const SIDE = 48

/**
 * The most margin a plugin may ask for. Above this the measurement that chose
 * 48 stops holding - the note row starts pushing the list off a short window -
 * and the app is entitled to the last word about its own page.
 */
const WIDEST = 64

/** Below this a box would be most of the row it sits in. */
const NARROWEST = 16

/**
 * @typedef {object} Box
 * @property {string} plugin
 * @property {Picture} picture
 * @property {number} width
 * @property {number} height
 */

/**
 * How big this plugin's box wants to be.
 *
 * @param {Manifest} manifest
 * @returns {{width: number, height: number}}
 */
export function boxSize(manifest) {
  const options = slotOptions(manifest, 'page.box')
  const bounds = { fallback: SIDE, least: NARROWEST, most: WIDEST }
  return {
    width: optionNumber(options, 'width', bounds),
    height: optionNumber(options, 'height', bounds),
  }
}

/**
 * What the plugin is told. The day, four counts and five colours, and nothing
 * else.
 *
 * No `kind` and no `now`, though the spec's sketch of this question had both:
 * the host writes those over every question itself, from the slot's name and
 * its own clock (`plugins/waiting.rs`, `envelope`), precisely so that nothing
 * a plugin is told privately can talk over them. A `kind` put in here would be
 * overwritten with `page.box` on the way out, and a `now` with the host's.
 * `date` is the day the page is showing, which is not always today.
 *
 * `theme` rides along because an `<img>` is an independent document:
 * `currentColor` does not reach into one and neither does a stylesheet, so a
 * picture that is to sit on the paper it is drawn on has to be handed the
 * paper's colours and bake them in. This was an assertion in the phases spec
 * and a demonstrated requirement by the time the mockups were built - the same
 * drawing is invisible on Composition Book without it.
 *
 * @param {string} date  `YYYY-MM-DD`, the day the page is showing
 * @param {DayGlance} glance
 * @param {Record<string, string>} theme
 * @returns {{date: string, glance: DayGlance, theme: Record<string, string>}}
 */
export function boxQuestion(date, glance, theme) {
  return { date, glance, theme }
}

/**
 * The five colours a picture is handed, of everything the theme holds.
 *
 * Five rather than all thirteen because these are the ones a drawing can use:
 * the rest are fonts, a radius and a page texture, which an SVG 48 points
 * across has no use for, and a token a plugin is shown is a token it can tell
 * you about.
 */
export const PAINTS = Object.freeze(['paper', 'ink', 'dim', 'accent', 'alert'])

/**
 * The paints, out of whatever the window is actually wearing.
 *
 * @param {Map<string, string>} tokens
 * @returns {Record<string, string>}
 */
export function paints(tokens) {
  /** @type {Record<string, string>} */
  const picked = {}
  for (const name of PAINTS) {
    const value = tokens.get(name)
    if (value !== undefined) picked[name] = value
  }
  return picked
}

/**
 * The one box the margin draws, or none.
 *
 * **Two plugins answering means neither is drawn.** There is one margin, so
 * two claims on it is not a thing the page can show half of, and picking the
 * first would make which creature you get depend on the order plugins happen
 * to be listed in. The notice names both, and turning one off in the pane is
 * the fix. This follows the same rule the host applies to a claim two plugins
 * both made, rather than inventing a second answer for the same situation.
 *
 * @param {{plugin: string, value: unknown}[]} answers
 * @param {Map<string, {width: number, height: number}>} sizes  by plugin name
 * @returns {{box: Box|null, notices: string[]}}
 */
export function readBox(answers, sizes) {
  /** @type {Box[]} */
  const drawn = []
  /** @type {string[]} */
  const notices = []

  for (const answer of answers) {
    // Nothing to say is an answer. A plugin with no picture this time is not
    // a plugin in the wrong shape.
    if (answer.value === null || answer.value === undefined) continue

    if (typeof answer.value !== 'object' || Array.isArray(answer.value)) {
      notices.push(`${answer.plugin} answered the margin with something that is not a picture`)
      continue
    }

    const read = readPicture(/** @type {{svg?: unknown}} */ (answer.value).svg)
    if ('refused' in read) {
      notices.push(`${answer.plugin} ${read.refused}`)
      continue
    }

    const size = sizes.get(answer.plugin) ?? { width: SIDE, height: SIDE }
    drawn.push({ plugin: answer.plugin, picture: read.picture, ...size })
  }

  if (drawn.length > 1) {
    const names = drawn.map((one) => one.plugin).join(' and ')
    return { box: null, notices: [...notices, `${names} both want the day's margin, so neither is drawn`] }
  }

  return { box: drawn[0] ?? null, notices }
}
