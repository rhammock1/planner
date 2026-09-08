// @ts-check

/**
 * What the sky does to the page.
 *
 * The whole of `dusk`'s opinion, as one pure function of the theme's own
 * tokens and where the sun is. `index.js` holds the API and the location and
 * nothing else, which is what lets the promise below be a test rather than a
 * claim.
 *
 * **Two halves, and the join between them is the design.**
 *
 * Through twilight the *surfaces* move - `paper`, `surface`, `edge`,
 * `edge-soft`, and a sky in `texture` - and the marks are held where their
 * theme put them. The ink does not travel; it does not have to, because it
 * starts with room to spare. The quieter marks have none: Ledger's `dim` is
 * 3.4:1 on Ledger's own paper, and the same grey on the paper of last light
 * is 1.9:1, which is not quiet, it is gone. So each is walked just far enough
 * to keep the contrast its author gave it. Nothing on the page gets harder to
 * read than it was at noon.
 *
 * At civil dusk the page turns over, in one step, and everything changes at
 * once. It has to be one step. There is no continuous path from dark ink on
 * light paper to light ink on dark paper that avoids the two passing through
 * the same luminance, and the same luminance is a page you cannot read - so a
 * page that dissolved into night would spend the crossing unreadable. It does
 * not dissolve. It turns, at the hour a person reaches for a lamp anyway.
 */

import {
  mix, shifted, alpha, luminance, contrast, legible, readable, ramp, ease,
} from './colour.js'

/** Where twilight starts: the sun this far above the horizon. */
const FIRST = 6

/** And where the lamp comes on. Civil dusk, by its published definition. */
const LAMP = -6

/**
 * The longest value the app will take for a token, from `docs/plugins.md`.
 *
 * Relied on rather than guessed at: a value over it is dropped whole, and a
 * dropped `texture` is no sky at all. Knowing the number is what lets the sky
 * give up the theme's own layer instead of giving up itself.
 */
export const LONGEST = 400

/**
 * The reference pair for the surfaces: Ledger in daylight, and the same page
 * at last light, just before the lamp.
 *
 * One row rather than two maps, because a name present in one and missing
 * from the other is then not a thing that can be written down - and because
 * this row is what `manifest.toml`'s `moves` list has to agree with.
 *
 * Only the four surfaces. `shifted` is a per-channel ratio and a ratio is
 * only meaningful where the reference is near what the theme actually set;
 * taken from a near-black ink and applied to a pale one it comes back a tint.
 * The marks are handled by the turn, or not at all.
 *
 * @type {readonly [string, string, string][]}
 */
const SURFACES = [
  ['paper', '#FBFAF6', '#D8B9B4'],
  ['surface', '#F4F2EA', '#CDACAA'],
  ['edge', '#D9D6CC', '#B08E8E'],
  ['edge-soft', '#E7E4DA', '#C4A29F'],
]

/**
 * What this file has to be able to read before it moves anything, and the two
 * more the turn needs on top. Named rather than "every colour token", because
 * a theme whose `alert` is `crimson` should still get its sunset.
 *
 * @type {readonly string[]}
 */
const DEEPENS = ['paper', 'surface', 'edge', 'edge-soft', 'ink']

/** @type {readonly string[]} */
const TURNS = ['accent', 'alert']

/**
 * The marks: what is read rather than what is under it.
 *
 * They do not travel through twilight, but the paper does, and a contrast is
 * a fact about a pair. Ledger's `dim` is 3.5:1 on Ledger's own paper - quiet
 * on purpose, with nothing spare - and by last light the same grey on the
 * deepened paper is 1.9:1, which is not quiet, it is gone.
 *
 * @type {readonly string[]}
 */
const MARKS = ['ink', 'dim', 'accent', 'alert']

/**
 * How much contrast is worth holding a mark at.
 *
 * Each one keeps what its theme gave it, capped here: `ink` starts at 14:1 and
 * does not need defending down to 9, while `dim` starts at 3.5 and needs every
 * bit of it. The cap is the published readable-text threshold, so the rule is
 * "no mark ends up harder to read than it was, and none is dragged past the
 * point where more stops being the point".
 */
const ENOUGH = 4.5

/** What a theme that set nothing would have set. @type {Record<string, string>} */
const DEFAULTS = {
  paper: '#FBFAF6', surface: '#F4F2EA', edge: '#D9D6CC', 'edge-soft': '#E7E4DA',
  ink: '#23262A', dim: '#8B8981', accent: '#17605B', alert: '#A8452C', texture: 'none',
}

/**
 * @typedef {object} Sky
 * @property {number} at  the sun's altitude, degrees
 * @property {string} horizon  low, where the sun is
 * @property {string} zenith  overhead
 * @property {string} belt  opposite the sun
 */

/** Above this the sky is daylight and there is nothing to interpolate. */
const DAYLIGHT = { at: 40, horizon: '#D7E5F4', zenith: '#8FB2DE', belt: '#DEE8F4' }

/** And below this it is night, which does not get any darker. */
const NIGHT = { at: -50, horizon: '#100E24', zenith: '#08091B', belt: '#111024' }

/**
 * The sky, by the sun's altitude in degrees.
 *
 * Sampled from what twilight actually does rather than from a hue wheel: gold
 * well before the horizon, orange at it, crimson just under, the magenta into
 * violet band through civil dusk, and gone by -18. `belt` is the anti-solar
 * side - the Belt of Venus over the earth's own shadow, which is why it is
 * pink over blue-grey and why it only exists for the few degrees it does.
 *
 * Descending, and interpolated in sRGB the way `mix` works, so what this table
 * says is what the page can actually be given.
 *
 * @type {readonly Sky[]}
 */
const TWILIGHT = [
  DAYLIGHT,
  { at: 12, horizon: '#FBEBCC', zenith: '#93B7DE', belt: '#E4E8F2' },
  { at: 6, horizon: '#FCDCA6', zenith: '#89ABD6', belt: '#EBDCDE' },
  { at: 2, horizon: '#FAC077', zenith: '#83A0CE', belt: '#F0CBD0' },
  { at: -0.833, horizon: '#F7A65B', zenith: '#7B93C4', belt: '#F0C0C8' },
  { at: -2, horizon: '#EA6F3C', zenith: '#6C7FB4', belt: '#EDAFBA' },
  { at: -4, horizon: '#C74A50', zenith: '#56659E', belt: '#D998A9' },
  { at: -6, horizon: '#9A3A57', zenith: '#3F4A83', belt: '#A87E98' },
  { at: -9, horizon: '#5E2B52', zenith: '#2C3468', belt: '#6A5A82' },
  { at: -12, horizon: '#34214B', zenith: '#1C2249', belt: '#3B3658' },
  { at: -18, horizon: '#181531', zenith: '#0E1129', belt: '#1B1931' },
  NIGHT,
]

/**
 * The sky at an altitude, between the two rows it falls between.
 *
 * Clamped at both ends by starting from the two that bracket everything: a sun
 * higher than the table is daylight, and one lower is night.
 *
 * @param {number} altitude  degrees
 * @returns {{horizon: string, zenith: string, belt: string}}
 */
export function skyAt(altitude) {
  let above = DAYLIGHT
  let below = NIGHT
  for (const row of TWILIGHT) {
    if (row.at >= altitude) above = row
    else { below = row; break }
  }
  const span = above.at - below.at
  const part = span <= 0 ? 0 : ramp(above.at - altitude, 0, span)
  return {
    horizon: mix(above.horizon, below.horizon, part),
    zenith: mix(above.zenith, below.zenith, part),
    belt: mix(above.belt, below.belt, part),
  }
}

/**
 * What to move, and how far.
 *
 * Empty in daylight: at nought there is nothing to move, and an empty map
 * leaves the theme alone rather than restating it.
 *
 * @param {Record<string, string>} tokens  every token, as the theme set it
 * @param {{altitude: number, azimuth: number}|null} sun
 * @returns {Record<string, string>} a partial map of tokens
 */
export function nightfall(tokens, sun) {
  if (sun === null) return {}
  const { altitude, azimuth } = sun

  // Nought when the sun is FIRST degrees up, one when it reaches the lamp.
  const falling = ease(ramp(-altitude, -FIRST, -LAMP))
  if (falling <= 0) return {}

  const set = (/** @type {string} */ name) => setting(tokens, name)

  // Nothing makes a theme's colours hex. `theme.js` checks what could escape
  // a CSS rule rather than what shape a colour is, so `white` and
  // `rgb(255,255,255)` are legal values for `paper` - and this file cannot do
  // arithmetic on either. A theme it cannot read is left exactly as its author
  // wrote it, which is the answer this app gives everywhere else it cannot
  // read something.
  if (!DEEPENS.every((name) => readable(set(name)))) return {}

  const sky = skyAt(altitude)
  // A theme whose paper is already darker than its ink is already a night
  // page, and there is nothing to hand over - inverting it would turn the
  // lamp on by making the room brighter. It gets the deepening and the sky
  // and keeps its own ink. So does one whose accent this file cannot read:
  // last light still holds the theme's own ink, and is the safe half.
  const turned =
    altitude <= LAMP &&
    luminance(set('paper')) > luminance(set('ink')) &&
    TURNS.every((name) => readable(set(name)))

  /** @type {Record<string, string>} */
  const moved = { texture: texture(tokens, sky, altitude, azimuth, turned) }

  // The surfaces, always: the theme's own colour moved the way the reference
  // pair moves, so a dark theme deepens by the same proportion rather than
  // being lightened toward Ledger's cream.
  for (const [name, day, night] of SURFACES) {
    const own = set(name)
    moved[name] = mix(own, shifted(own, day, night), falling)
  }

  if (!turned) {
    // And the marks held where the theme put them. A mark that still clears
    // the ratio it had at noon comes back untouched and is left out of the
    // answer entirely, so through the first degrees of this nothing but the
    // surfaces is in the map at all.
    const paper = moved['paper'] ?? set('paper')
    for (const name of MARKS) {
      const own = set(name)
      const held = legible(own, paper, Math.min(contrast(own, set('paper')), ENOUGH))
      if (held !== own) moved[name] = held
    }
    return moved
  }

  // The turn. Built from the two colours the theme itself set, so it works on
  // a theme this plugin has never seen: the night page is that theme's own
  // ink cooled toward the zenith, and the night ink is its own paper under a
  // lamp. A theme with a darker ink arrives at a darker night.
  const paper = mix(mix(set('ink'), sky.zenith, 0.34), '#000000', 0.06)
  const ink = legible(mix(set('paper'), '#F2E4C8', 0.34), paper, 7)

  moved['paper'] = paper
  moved['ink'] = ink
  moved['surface'] = mix(paper, sky.zenith, 0.26)
  moved['edge'] = mix(paper, ink, 0.3)
  moved['edge-soft'] = mix(paper, ink, 0.15)
  // As quiet as `dim` is by day, and no quieter: it carries the times and the
  // lines you have finished with, which are meant to be present and not
  // competing rather than absent.
  moved['dim'] = legible(mix(ink, paper, 0.5), paper, 3.5)
  // The theme keeps its hue and gains the lamp. Lifted afterwards rather than
  // chosen bright, so a theme whose accent is nearly the colour of its night
  // paper still has an accent.
  moved['accent'] = legible(mix(set('accent'), '#E0A961', 0.45), paper, 4.5)
  moved['alert'] = legible(mix(set('alert'), '#E8785B', 0.4), paper, 4.5)

  return moved
}

/**
 * The sky, as a stack of background layers over whatever the theme had there.
 *
 * Two layers of this plugin's own, and a third that depends on the hour:
 *
 * - the **glow**, at the sun's own bearing across the page and sinking with
 *   its altitude, so the light comes in from the edge it comes in from;
 * - the **band** opposite it, the Belt of Venus, which exists for about five
 *   degrees either side of the horizon and then does not;
 * - and underneath those, before the turn, the theme's own texture, which the
 *   deepened paper still suits; after it, the **vault** - a zenith over the
 *   whole page, so a night page is still a sky and not a flat fill.
 *
 * The theme's texture is dropped once the page has turned over, and that is a
 * limit rather than a preference: it arrives as an opaque string, so a plugin
 * can layer over it but cannot re-tint it. Ledger's dot grid is drawn in a
 * paper shadow; left on an inverted page it is a field of bright specks across
 * the words.
 *
 * @param {Record<string, string>} tokens
 * @param {{horizon: string, zenith: string, belt: string}} sky
 * @param {number} altitude
 * @param {number} azimuth
 * @param {boolean} turned
 * @returns {string}
 */
function texture(tokens, sky, altitude, azimuth, turned) {
  const down = -altitude
  // Direct light: rising from the first degree this plugin answers at, gone a
  // few degrees under the horizon. What is left after that is the ember,
  // which outlasts it.
  //
  // `-FIRST` rather than a number of its own. A ramp beginning higher than the
  // altitude `nightfall` starts answering at would put the glow on the page at
  // a fifth of its strength in a single step, which is the visible edge every
  // `ease` in this file exists to prevent.
  const direct = ease(ramp(down, -FIRST, 1)) * (1 - ease(ramp(down, 2, 9)))
  const ember = 1 - ease(ramp(down, 6, 15))
  const opposite = ease(ramp(down, -1, 4)) * (1 - ease(ramp(down, 6, 13)))

  // How far east or west the sun is, which is the whole of what "which edge is
  // the light coming from" means: the east-west component of its bearing, east
  // at the left. Past the edges on purpose, so a sun due west reads as light
  // from beyond the page rather than a lamp sitting on it.
  //
  // A sine of the bearing and not a line across it, because a bearing is a
  // circle and a line laid on a circle has to break somewhere. Laid the
  // obvious way it breaks at due north - and the sun passes through due north
  // during twilight every summer night above about 66 degrees, where the glow
  // would cross the whole page between one minute and the next. Projected, a
  // sun swinging through north comes back toward the middle, which is where it
  // is.
  const across = 50 - 60 * Math.sin((azimuth * Math.PI) / 180)
  const facing = 100 - across
  const sinking = Math.max(-30, Math.min(130, 10 + (2 - altitude) * 2.6))

  const glow = `radial-gradient(64% 46% at ${across.toFixed(0)}% ${sinking.toFixed(0)}%, ${alpha(sky.horizon, turned ? 0.46 * ember : 0.72 * direct)}, transparent 66%)`
  const band = `radial-gradient(90% 34% at ${facing.toFixed(0)}% 2%, ${alpha(sky.belt, 0.4 * opposite * (turned ? 0.35 : 1))}, transparent 70%)`

  if (turned) {
    const vault = `linear-gradient(180deg, ${alpha(sky.zenith, 0.5)}, ${alpha(sky.horizon, 0.22)} 74%)`
    return `${glow}, ${band}, ${vault}`
  }

  const own = tokens['texture'] ?? DEFAULTS['texture'] ?? 'none'
  const layers = `${glow}, ${band}`
  // A theme is entitled to a long texture of its own, and a sky that was
  // dropped for being one character over would be no sky at all. Its own
  // layer is the one to give up.
  if (own === 'none' || `${layers}, ${own}`.length > LONGEST) return layers
  return `${layers}, ${own}`
}

/**
 * The contrast between the ink and the paper this palette leaves on the page.
 *
 * Exported for the test that walks a whole day a minute at a time and asserts
 * it never sags - which is the promise this plugin makes about the list, and
 * the reason the turn is a cut.
 *
 * @param {Record<string, string>} tokens
 * @param {Record<string, string>} moved
 * @returns {number}
 */
export function legibility(tokens, moved) {
  const paper = moved['paper'] ?? setting(tokens, 'paper')
  return contrast(moved['ink'] ?? setting(tokens, 'ink'), paper)
}

/**
 * What the theme set, or what a theme that set nothing would have.
 *
 * @param {Record<string, string>} tokens
 * @param {string} name
 * @returns {string}
 */
function setting(tokens, name) {
  return tokens[name] ?? DEFAULTS[name] ?? '#000000'
}
