// @ts-check

/**
 * Colour arithmetic, per channel in sRGB.
 *
 * The same space `mix` has always worked in, and deliberately: what this file
 * computes has to be a value the app will accept and a browser will paint, so
 * a nicer perceptual space here would only be a nicer way to arrive at the
 * same six hex digits.
 *
 * Its own file so it can be tested by `node --test` with no `planner` object
 * in the room, and because "what colour" and "where the sun is" (`sun.js`) are
 * two different questions that happen to meet in `palette.js`.
 */

/**
 * A colour part of the way from one to another.
 *
 * @param {string} from `#RRGGBB`
 * @param {string} to `#RRGGBB`
 * @param {number} amount  0 is `from`, 1 is `to`
 * @returns {string} `#rrggbb`
 */
export function mix(from, to, amount) {
  const one = channels(from)
  const two = channels(to)
  return hex(one.map((value, at) => value + ((two[at] ?? value) - value) * amount))
}

/**
 * `colour`, moved the way `day` moves to `night`.
 *
 * This is what lets one plugin deepen a theme it has never seen. The app shows
 * a `theme.tokens` plugin the theme's own colours, and returning a palette of
 * its own would *replace* them - so what travels here is the transformation
 * rather than the destination: the ratio each channel takes from `day` to
 * `night`, applied to whatever the theme actually set.
 *
 * A ratio rather than a difference, because a difference measured on a light
 * theme lightens a dark one. Ledger's `paper` loses a quarter of its blue by
 * last light; a dark theme's paper loses a quarter of its own, and stays dark.
 *
 * **Only meaningful where `day` is near what the theme actually set.** A ratio
 * taken from a near-black reference and applied to a near-white colour
 * multiplies the gap between its channels and comes back a tint - which is why
 * `palette.js` uses this for the four surfaces and never for the ink.
 *
 * @param {string} colour  what the theme set
 * @param {string} day  this plugin's reference colour in daylight
 * @param {string} night  the same colour at last light
 * @returns {string} `#rrggbb`
 */
export function shifted(colour, day, night) {
  const from = channels(colour)
  const before = channels(day)
  const after = channels(night)
  return hex(from.map((value, at) => {
    const was = before[at] ?? 0
    // A channel already at nought cannot be scaled, and has nowhere to go.
    const ratio = was === 0 ? 1 : (after[at] ?? was) / was
    return value * ratio
  }))
}

/**
 * A colour with an opacity on it, as CSS's eight-digit hex.
 *
 * Gradient stops rather than tokens: a `paper` with an alpha would let the
 * window through, and the window behind this one is the desktop.
 *
 * @param {string} colour `#RRGGBB`
 * @param {number} amount  0 to 1
 * @returns {string} `#rrggbbaa`
 */
export function alpha(colour, amount) {
  const byte = Math.round(Math.max(0, Math.min(1, amount)) * 255)
  return `${colour}${byte.toString(16).padStart(2, '0')}`
}

/**
 * Relative luminance, WCAG 2.1.
 *
 * @param {string} colour `#RRGGBB`
 * @returns {number} 0 to 1
 */
export function luminance(colour) {
  const [red = 0, green = 0, blue = 0] = channels(colour).map((value) => {
    const part = value / 255
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/**
 * The contrast ratio between two colours, 1 to 21.
 *
 * @param {string} one `#RRGGBB`
 * @param {string} two `#RRGGBB`
 * @returns {number}
 */
export function contrast(one, two) {
  const first = luminance(one)
  const second = luminance(two)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/**
 * How finely `legible` looks for the nearest colour that will do.
 *
 * Fine enough that a mark being held against a paper that is sliding all
 * evening slides with it rather than stepping: at twenty the first correction
 * was a twentieth of the way to black, which is a jump you could see arrive.
 * Fifty contrast sums, at most, four times a minute.
 */
const STEPS = 50

/**
 * `colour`, moved away from `against` until it can be read on it.
 *
 * The guarantee rather than the hope. A night palette worked out by mixing is
 * a palette that can land anywhere, and "anywhere" includes a page whose ink
 * and paper are the same shade of slate. This walks the colour toward the end
 * of the scale that the ground reads best against, and stops at the first step
 * that clears the ratio - so a colour that already reads is returned
 * untouched, and the theme's own hue survives as far as it can.
 *
 * Returns that end if nothing clears the ratio: it is the best any colour can
 * do against this ground, and still the most readable answer available.
 *
 * @param {string} colour `#RRGGBB`
 * @param {string} against `#RRGGBB` - the surface it will sit on
 * @param {number} ratio  the contrast it has to clear
 * @returns {string} `#rrggbb`
 */
export function legible(colour, against, ratio) {
  if (contrast(colour, against) >= ratio) return colour

  // Whichever of the two ends the ground actually reads better against, asked
  // rather than derived. A luminance threshold looks like the same thing and
  // is not: white beats black only below about 0.18, not below a half, so a
  // ground in the middle - a slate paper, a mid-grey surface - would be given
  // the worse of the two ends by any half-way rule.
  const away = contrast('#ffffff', against) >= contrast('#000000', against) ? '#ffffff' : '#000000'

  // The first step that clears it, rather than the best step. Where `colour`
  // starts on the far side of the ground the walk passes through it and the
  // ratio dips before it climbs, so this is not a search over a monotone
  // curve - but the first clearing step is still the one that has travelled
  // least from the colour the theme chose, which is the thing being preserved.
  for (let step = 1; step <= STEPS; step += 1) {
    const moved = mix(colour, away, step / STEPS)
    if (contrast(moved, against) >= ratio) return moved
  }
  return away
}

/**
 * Where `value` sits between two bounds, as nought to one.
 *
 * @param {number} value
 * @param {number} low  the value that reads as 0
 * @param {number} high  the value that reads as 1
 * @returns {number} 0 to 1
 */
export function ramp(value, low, high) {
  if (high === low) return value >= high ? 1 : 0
  return Math.max(0, Math.min(1, (value - low) / (high - low)))
}

/**
 * A ramp with the corners taken off both ends.
 *
 * Smoothstep. What it buys is that nothing on the page arrives or leaves with
 * an edge on it: asked once a minute, a linear ramp's first and last steps are
 * the two you can see.
 *
 * @param {number} amount  0 to 1
 * @returns {number} 0 to 1
 */
export function ease(amount) {
  return amount * amount * (3 - 2 * amount)
}

/** @param {number[]} values @returns {string} */
function hex(values) {
  return `#${values
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')}`
}

/** `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`, and nothing else. */
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * A colour's three channels, or nothing.
 *
 * **The reason this can fail, and must.** A theme's tokens are a theme
 * author's strings, and nothing makes them hex: `theme.js`'s checks are about
 * what could escape a CSS rule, so `white`, `#fff` and `rgb(255,255,255)` are
 * all perfectly legal values for `paper`. Read positionally, `white` comes
 * back as `#000000` — and then this plugin's arithmetic quietly concludes the
 * page is already black, never turns it over, and walks the paper down to
 * meet ink that is already dark. A legal theme would spend every night as
 * black text on a black page.
 *
 * So the two-digit slice is a parse now, and `palette.js` leaves a theme it
 * cannot read entirely alone. Refusing to guess is the answer this app gives
 * everywhere else it cannot read something.
 *
 * An alpha, where there is one, is dropped: this is being asked what colour
 * something is.
 *
 * @param {string} colour
 * @returns {number[]|null}
 */
export function readColour(colour) {
  const value = colour.trim()
  if (!HEX.test(value)) return null
  const digits = value.slice(1)
  const wide = digits.length > 4
  const step = wide ? 2 : 1
  return [0, 1, 2].map((at) => {
    const part = digits.slice(at * step, at * step + step)
    return Number.parseInt(wide ? part : `${part}${part}`, 16)
  })
}

/**
 * Whether a value is a colour this file can do arithmetic on.
 *
 * What `palette.js` asks before it moves anything, so a theme written in
 * named colours or `rgb()` is left as its author wrote it rather than
 * rearranged into something unreadable.
 *
 * @param {string} colour
 * @returns {boolean}
 */
export function readable(colour) {
  return readColour(colour) !== null
}

/**
 * The same, for the arithmetic below, which is only ever reached with values
 * `readable` has already passed.
 *
 * @param {string} colour
 * @returns {number[]}
 */
function channels(colour) {
  return readColour(colour) ?? [0, 0, 0]
}
