// @ts-check

/**
 * When the sun rises and sets, and how far through dusk a moment is.
 *
 * The NOAA general solar position equations, which is the whole reason this
 * plugin needs no network: sunrise is arithmetic on a date and two numbers.
 * This is the precedent for the next plugin that thinks it needs `net.fetch` -
 * it probably needs a setting.
 *
 * Its own file so that it can be tested by `node --test` with no `planner`
 * object in the room. Nothing here touches the API; `index.js` is the half
 * that does.
 *
 * Everything in and out is in **UTC minutes past midnight** except
 * `localMinutes`, which is the one function that knows what a timezone is.
 */

/** Half the ramp either side of an event, in minutes: an hour, in four
 *  quarter-hour steps (spec §3.3). */
const HALF = 30

/** The centre of the sun, below the horizon by its own radius plus the
 *  refraction of the atmosphere. What "sunrise" means. */
const HORIZON = 90.833

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Sunrise and sunset, in minutes past midnight UTC.
 *
 * Null where the sun does not cross the horizon at all that day - inside
 * either polar circle, in either direction - because there is then no event to
 * interpolate over and nothing honest to say about dusk.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {number} latitude  degrees, north positive
 * @param {number} longitude  degrees, east positive
 * @returns {{sunrise: number, sunset: number}|null}
 */
export function sunEvents(date, latitude, longitude) {
  const day = julianDay(date)
  if (day === null) return null

  const t = (day - 2451545) / 36525

  // Geometric mean longitude and anomaly of the sun, in degrees.
  const meanLongitude = 280.46646 + t * (36000.76983 + t * 0.0003032)
  const anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)

  const centre =
    Math.sin(rad(anomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * anomaly)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * anomaly)) * 0.000289

  // The apparent longitude: the true one, less aberration and nutation.
  const apparent =
    meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t))

  const meanTilt =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const tilt = meanTilt + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t))

  const declination = Math.asin(Math.sin(rad(tilt)) * Math.sin(rad(apparent)))

  // The equation of time, in minutes: how far a sundial is from a clock.
  const y = Math.tan(rad(tilt / 2)) ** 2
  const equation =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLongitude)) -
        2 * eccentricity * Math.sin(rad(anomaly)) +
        4 * eccentricity * y * Math.sin(rad(anomaly)) * Math.cos(2 * rad(meanLongitude)) -
        0.5 * y * y * Math.sin(4 * rad(meanLongitude)) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * rad(anomaly)),
    )

  const cosine =
    Math.cos(rad(HORIZON)) / (Math.cos(rad(latitude)) * Math.cos(declination)) -
    Math.tan(rad(latitude)) * Math.tan(declination)
  // Out of range is a day with no sunrise or no sunset in it at all.
  if (cosine > 1 || cosine < -1) return null

  // Four minutes a degree, and westward is later.
  const noon = 720 - 4 * longitude - equation
  const half = 4 * deg(Math.acos(cosine))
  return { sunrise: noon - half, sunset: noon + half }
}

/**
 * A UTC minute of a given day, as minutes past *local* midnight.
 *
 * The one function here that knows what a timezone is, and the one thing spec
 * §1.1 allows `Date` for: the rule is about a plugin not holding a clock of
 * its own, not about a plugin never reading one.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {number} utcMinutes
 * @returns {number}
 */
export function localMinutes(date, utcMinutes) {
  const parts = DATE.exec(date)
  if (parts === null) return 0
  const at = new Date(
    Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) +
      Math.round(utcMinutes) * 60000,
  )
  return at.getHours() * 60 + at.getMinutes()
}

/**
 * @param {string} time `HH:MM`
 * @returns {number} minutes past midnight
 */
export function minutesOf(time) {
  const [hour, minute] = time.split(':')
  return Number(hour ?? 0) * 60 + Number(minute ?? 0)
}

/**
 * Minutes from `event` to `now`, the short way round a 24-hour clock.
 *
 * Negative before the event, positive after, never outside twelve hours - so
 * 23:50 is ten minutes *before* midnight's event rather than 1430 after it.
 *
 * @param {number} now  minutes past local midnight
 * @param {number} event  the same
 * @returns {number} -720 to 720
 */
function toward(now, event) {
  return ((((now - event + 720) % 1440) + 1440) % 1440) - 720
}

/**
 * How far into the evening a moment is: nought in daylight, one at night.
 *
 * A straight ramp over the hour centred on each event, which at the quarter
 * hour is four steps across it. Monotone across each event, so a page redrawn
 * a minute later never goes back the way it came.
 *
 * **The clock is a circle, and that is the whole difficulty.** Read as a line
 * this is four comparisons; read as a line it is also wrong wherever local
 * sunset lands after local midnight, which is most of western Alaska and any
 * place sitting far enough west inside its timezone. There `sunset < sunrise`
 * as numbers, every comparison falls through, and the answer is 1 at every
 * hour of the day - midsummer noon in the full night palette, with no time of
 * day that recovers. So the events are located by the short way round instead,
 * and daylight is the arc running forward from sunrise to sunset rather than
 * the interval between two numbers.
 *
 * @param {number} now  minutes past local midnight
 * @param {number} sunrise  the same
 * @param {number} sunset  the same
 * @returns {number} 0 to 1
 */
export function warmthAt(now, sunrise, sunset) {
  const dawn = toward(now, sunrise)
  const dusk = toward(now, sunset)

  // The nearer event owns the moment. They can only both be in range where
  // the whole of daylight is under an hour, and there the answer wanted is
  // the one belonging to the event actually being crossed.
  if (Math.abs(dawn) < HALF && Math.abs(dawn) <= Math.abs(dusk)) {
    return (HALF - dawn) / (HALF * 2)
  }
  if (Math.abs(dusk) < HALF) return (dusk + HALF) / (HALF * 2)

  const since = (((now - sunrise) % 1440) + 1440) % 1440
  const daylight = (((sunset - sunrise) % 1440) + 1440) % 1440
  return since < daylight ? 0 : 1
}

/**
 * A colour part of the way from one to another, per channel in sRGB.
 *
 * @param {string} from `#RRGGBB`
 * @param {string} to `#RRGGBB`
 * @param {number} amount  0 is `from`, 1 is `to`
 * @returns {string} `#rrggbb`
 */
export function mix(from, to, amount) {
  const one = channels(from)
  const two = channels(to)
  return hex(one.map((value, at) => Math.round(value + ((two[at] ?? value) - value) * amount)))
}

/**
 * `colour`, moved the way `day` moves to `night`.
 *
 * This is what lets one plugin warm a theme it has never seen. The app shows
 * a `theme.tokens` plugin the theme's own colours, and returning a palette of
 * its own would *replace* them - so what travels here is the transformation
 * rather than the destination: the ratio each channel takes from `day` to
 * `night`, applied to whatever the theme actually set.
 *
 * A ratio rather than a difference, because a difference measured on a light
 * theme lightens a dark one. Ledger's `paper` loses a tenth of its blue at
 * night; a dark theme's paper loses a tenth of its own, and stays dark.
 *
 * @param {string} colour  what the theme set
 * @param {string} day  this plugin's reference colour in daylight
 * @param {string} night  the same colour under a lamp
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
    return Math.max(0, Math.min(255, Math.round(value * ratio)))
  }))
}

/** @param {number[]} values @returns {string} */
function hex(values) {
  return `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/**
 * A place typed into a settings row, as `latitude,longitude`.
 *
 * The fallback for a Mac that will not say where it is - and the reason this
 * plugin works at all on one that never will.
 *
 * @param {string} text
 * @returns {{latitude: number, longitude: number}|null}
 */
export function readPlace(text) {
  const parts = text.split(',')
  if (parts.length !== 2) return null
  const [left = '', right = ''] = parts
  // Before `Number`, because `Number('')` is 0 and 0,0 is a real place in the
  // Gulf of Guinea. A row holding `,` would otherwise put somebody's sunset
  // six degrees off the equator without ever looking wrong.
  if (left.trim() === '' || right.trim() === '') return null
  const latitude = Number(left.trim())
  const longitude = Number(right.trim())
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

/**
 * The Julian day at 00:00 UT, by the usual Gregorian conversion.
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {number|null}
 */
function julianDay(date) {
  const parts = DATE.exec(date)
  if (parts === null) return null

  let year = Number(parts[1])
  let month = Number(parts[2])
  const day = Number(parts[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  // January and February are the thirteenth and fourteenth months of the year
  // before, which is what makes the leap day the last day of it.
  if (month <= 2) {
    year -= 1
    month += 12
  }
  const century = Math.floor(year / 100)
  const gregorian = 2 - century + Math.floor(century / 4)
  return (
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    gregorian -
    1524.5
  )
}

/** @param {string} colour @returns {number[]} */
function channels(colour) {
  const hex = colour.replace('#', '')
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) || 0)
}

/** @param {number} degrees @returns {number} */
function rad(degrees) {
  return (degrees * Math.PI) / 180
}

/** @param {number} radians @returns {number} */
function deg(radians) {
  return (radians * 180) / Math.PI
}
