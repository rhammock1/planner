// @ts-check

/**
 * The creature itself: one SVG document, built from a mood and a streak.
 *
 * Drawn as a pen doodle - every shape filled with the paper's own colour and
 * outlined in its ink - which is why the five colours ride in the question.
 * An `<img>` is an independent document: `currentColor` does not reach into
 * one and neither does the page's stylesheet, so a creature that is to look
 * drawn *on* the page rather than pasted onto it has to be handed the page's
 * colours and bake them in.
 *
 * Nothing here is interactive and nothing here can be. There is no script, no
 * handler and no link that leaves the picture - `src/core/picture.js` refuses
 * all three, and this file has no use for any of them. A doodle in a margin is
 * looked at.
 *
 * Pure: a mood and four colours in, a string out. No `planner`, no DOM.
 */

/** @typedef {import('./mood.js').Mood} Mood */

/** What the drawing is laid out against, whatever size it ends up at. */
const SIDE = 48

/** The five the question carries, named here so a theme can be read without
 *  being indexed by a string nobody has checked. */
const PAINTS = /** @type {const} */ (['paper', 'ink', 'dim', 'accent', 'alert'])

/** What each is when the theme has not said. A theme missing one of these is
 *  a theme mid-edit, not a reason to refuse to draw. */
const FALLBACK = {
  paper: '#ffffff',
  ink: '#222222',
  dim: '#bbbbbb',
  accent: '#4477aa',
  alert: '#cc4433',
}

/**
 * @typedef {object} Drawing
 * @property {Mood} mood
 * @property {number} deep  0 to 1, how far into a streak of this mood
 * @property {Partial<Record<'paper'|'ink'|'dim'|'accent'|'alert', string>>} theme
 *   the five paints, any of them absent
 */

/**
 * The creature, as an SVG document.
 *
 * A `viewBox` and no `width` or `height`, on purpose. The app sizes the
 * `<img>` itself, from the `[box]` table in this plugin's manifest - so a
 * width written here would be the same number in two files, and the day the
 * manifest changed it would be the wrong one in one of them.
 *
 * @param {Drawing} drawing
 * @returns {string}
 */
export function petSvg({ mood, deep, theme }) {
  const paint = paints(theme)
  const body = mood === 'resting' ? curled(paint, deep) : sitting(mood, paint, deep)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIDE} ${SIDE}" role="img">`,
    `<style>${motion(mood, deep)}</style>`,
    `<ellipse cx="24" cy="${mood === 'resting' ? 43 : 44}" rx="${mood === 'resting' ? 14 : 12}"`,
    ` ry="1.8" fill="${paint.dim}"/>`,
    body,
    '</svg>',
  ].join('')
}

/**
 * The stylesheet, which is the only motion there is.
 *
 * CSS rather than SMIL for one reason: `prefers-reduced-motion` can be asked
 * inside an `<img>`, and a `<animate>` element cannot be told to stop by it. A
 * creature that keeps moving at somebody who has asked the whole machine to
 * stop moving is not charming.
 *
 * @param {Mood} mood
 * @param {number} deep
 * @returns {string}
 */
function motion(mood, deep) {
  const rules = []
  if (mood === 'working') {
    // Faster the longer the run has been going.
    const beat = (1.3 - 0.45 * deep).toFixed(2)
    rules.push(
      `.tail{transform-origin:33px 38px;animation:wag ${beat}s ease-in-out infinite alternate}`,
      '@keyframes wag{from{transform:rotate(-9deg)}to{transform:rotate(11deg)}}',
    )
  }
  if (mood === 'resting') {
    // Slower the longer it has been quiet: a week of clear days sleeps sounder
    // than one afternoon of them.
    const breath = (3.2 + 1.6 * deep).toFixed(2)
    rules.push(
      `.breath{transform-origin:26px 36px;animation:breathe ${breath}s ease-in-out infinite alternate}`,
      '@keyframes breathe{from{transform:scale(1)}to{transform:scale(1.035)}}',
    )
  }
  if (rules.length === 0) return ''
  rules.push('@media (prefers-reduced-motion: reduce){.tail,.breath{animation:none}}')
  return rules.join('')
}

/**
 * Sitting up: `fresh`, `working` and `fretting` are one pose with three faces.
 *
 * One pose rather than three drawings because that is what the mood table
 * says - the difference between watching and leaning in is the ears, the eyes
 * and the mouth, not a different animal.
 *
 * @param {Mood} mood
 * @param {Record<string, string>} paint
 * @param {number} deep
 * @returns {string}
 */
function sitting(mood, paint, deep) {
  const pen = `fill="${paint.paper}" stroke="${paint.ink}" stroke-width="2" stroke-linejoin="round"`
  const line = `fill="none" stroke="${paint.ink}" stroke-width="1.7" stroke-linecap="round"`

  // Negative is perked, positive is dropped - and `fretting` is dropped far
  // enough to lie along the head, not merely angled out. This is the one thing
  // in the drawing that has to read at 48 points: a face is four pixels of eye
  // at that size and a silhouette is the whole creature, so the moods differ
  // in outline first and in expression second.
  const droop =
    mood === 'fretting' ? 72 + 14 * deep : mood === 'fresh' ? -8 - 6 * deep : -2

  // The head leans, for the same reason. Nothing else about `working` survives
  // being shrunk to the margin.
  const lean = mood === 'working' ? 9 : mood === 'fretting' ? 4 : 0

  const parts = [
    `<path class="${mood === 'working' ? 'tail' : ''}" d="M33 39 C39.5 38 41.5 32.5 39.5 28"`,
    ` fill="none" stroke="${paint.ink}" stroke-width="2.4" stroke-linecap="round"/>`,
    `<path d="M14 43 C12 32 16 26.5 24 26.5 C32 26.5 36 32 34 43 Z" ${pen}/>`,
    // Head, ears and face turn together, around the neck. Rotating the head
    // alone would leave the ears behind, which does not read as a creature
    // leaning in; it reads as one coming apart.
    `<g transform="rotate(${round(lean)} 24 27)">`,
    // The ears are under the head, so the head's own fill hides where they
    // meet it - which is what makes this read as one creature rather than as
    // three shapes that happen to touch.
    `<path d="M16 12.5 L14 2.5 L21.5 9.5 Z" ${pen} transform="rotate(${round(-droop)} 19 11.5)"/>`,
    `<path d="M32 12.5 L34 2.5 L26.5 9.5 Z" ${pen} transform="rotate(${round(droop)} 29 11.5)"/>`,
    `<circle cx="24" cy="19.5" r="9.5" ${pen}/>`,
    `<path d="M16.8 26.5 Q24 30 31.2 26.5" fill="none" stroke="${paint.accent}"`,
    ' stroke-width="1.8" stroke-linecap="round"/>',
    face(mood, paint, deep, line),
    `<circle cx="24" cy="23" r="1.3" fill="${paint.ink}"/>`,
    '</g>',
  ]

  if (mood === 'fretting') {
    // One mark, in the alert colour, and only here. A creature that is worried
    // about something says so once.
    // Clear of the ear, which by now is lying along the head and reaches out
    // to about x=40. A mark drawn through the creature is a smudge, not a
    // mark.
    parts.push(
      `<path d="M44 6 V12" fill="none" stroke="${paint.alert}" stroke-width="2.2"`,
      ' stroke-linecap="round"/>',
      `<circle cx="44" cy="15" r="1.2" fill="${paint.alert}"/>`,
    )
  }
  return parts.join('')
}

/**
 * The face, which is the whole of the difference between the three.
 *
 * @param {Mood} mood
 * @param {Record<string, string>} paint
 * @param {number} deep
 * @param {string} line  the stroke attributes a feature is drawn with
 * @returns {string}
 */
function face(mood, paint, deep, line) {
  if (mood === 'working') {
    // Narrowed, which is a creature concentrating rather than a creature
    // half-asleep: the arcs bend down at the outer end, not the inner.
    return [
      `<path d="M18.2 20.4 Q20.6 18.4 22.9 20.2" ${line}/>`,
      `<path d="M25.1 20.2 Q27.4 18.4 29.8 20.4" ${line}/>`,
      `<path d="M21.6 25.6 Q24 27.4 26.4 25.6" ${line}/>`,
    ].join('')
  }

  if (mood === 'fretting') {
    const eye = round(1.9 - 0.5 * deep)
    const lift = 1 + 1.4 * deep
    return [
      // Brows up at the inner end, which is the one thing every drawn worried
      // face in the world has in common.
      `<path d="M18.4 ${round(16.2 - lift * 0.2)} L22 ${round(14.6 + lift)}" ${line}/>`,
      `<path d="M29.6 ${round(16.2 - lift * 0.2)} L26 ${round(14.6 + lift)}" ${line}/>`,
      `<circle cx="20.4" cy="19.8" r="${eye}" fill="${paint.ink}"/>`,
      `<circle cx="27.6" cy="19.8" r="${eye}" fill="${paint.ink}"/>`,
      `<path d="M21.6 27 Q24 25.2 26.4 27" ${line}/>`,
    ].join('')
  }

  // `fresh`: wide open and pointed at you. The catchlight is in the paper's
  // own colour, which is the other half of why the theme rides along - an ink
  // circle with no paper in it is a dot, not an eye.
  return [
    `<circle cx="20.4" cy="19.5" r="2.1" fill="${paint.ink}"/>`,
    `<circle cx="27.6" cy="19.5" r="2.1" fill="${paint.ink}"/>`,
    `<circle cx="21.1" cy="18.8" r="0.7" fill="${paint.paper}"/>`,
    `<circle cx="28.3" cy="18.8" r="0.7" fill="${paint.paper}"/>`,
    `<path d="M21.8 25.8 Q24 27.2 26.2 25.8" ${line}/>`,
  ].join('')
}

/**
 * Curled up, and not pretending otherwise.
 *
 * @param {Record<string, string>} paint
 * @param {number} deep
 * @returns {string}
 */
function curled(paint, deep) {
  const pen = `fill="${paint.paper}" stroke="${paint.ink}" stroke-width="2" stroke-linejoin="round"`
  const line = `fill="none" stroke="${paint.ink}" stroke-width="1.7" stroke-linecap="round"`

  return [
    '<g class="breath">',
    `<path d="M38 39 C45 37 45 28.5 38.5 27.5" fill="none" stroke="${paint.ink}"`,
    ' stroke-width="2.4" stroke-linecap="round"/>',
    `<ellipse cx="26" cy="33.5" rx="13" ry="8.5" ${pen}/>`,
    // Laid back along the body rather than up, because an ear pointing at the
    // ceiling on a sleeping animal is the thing that makes a drawing of one
    // look awake.
    `<path d="M13.5 26 L9 19.5 L18 24 Z" ${pen}/>`,
    `<circle cx="14.5" cy="31" r="7.5" ${pen}/>`,
    `<path d="M11.2 31.8 Q14.5 34.2 17.8 31.8" ${line}/>`,
    `<circle cx="9.6" cy="33.6" r="1.1" fill="${paint.ink}"/>`,
    `<path d="M20 31 Q23.5 32.6 27 31" fill="none" stroke="${paint.accent}"`,
    ' stroke-width="1.8" stroke-linecap="round"/>',
    '</g>',
    // A sounder sleep gets a second breath mark. Nothing else changes: the
    // streak moves the creature within its mood rather than giving it a
    // fifth face.
    `<path d="M33 18 Q36 15.5 33.5 13" ${line} opacity="${deep > 0.45 ? '1' : '0'}"/>`,
    `<path d="M38 22 Q41 19.5 38.5 17" ${line}/>`,
  ].join('')
}

/**
 * The five paints, each falling back to something that will still read.
 *
 * @param {Drawing['theme']} theme
 * @returns {Record<string, string>}
 */
function paints(theme) {
  /** @type {Record<string, string>} */
  const picked = {}
  for (const name of PAINTS) {
    const value = theme[name]
    // A colour with a quote or an angle bracket in it is not a colour, and
    // this string is about to become a document. `picture.js` would refuse
    // the result rather than draw it, which is a creature that silently stops
    // appearing because somebody's theme has a typo in it.
    picked[name] = typeof value === 'string' && /^[#\w(),.%\s-]{1,64}$/u.test(value)
      ? value.trim()
      : FALLBACK[name]
  }
  return picked
}

/**
 * A number, short enough that 48 of them do not make a big document.
 *
 * @param {number} value
 * @returns {string}
 */
function round(value) {
  return (Math.round(value * 10) / 10).toString()
}
