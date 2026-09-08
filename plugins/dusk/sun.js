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
 * How far into the evening a moment is: nought in daylight, one at night.
 *
 * A straight ramp over the hour centred on each event, which at the quarter
 * hour is four steps across it. Monotone in both directions, so a page
 * redrawn a minute later never goes back the way it came.
 *
 * @param {number} now  minutes past local midnight
 * @param {number} sunrise  the same
 * @param {number} sunset  the same
 * @returns {number} 0 to 1
 */
export function warmthAt(now, sunrise, sunset) {
  if (now <= sunrise - HALF) return 1
  if (now < sunrise + HALF) return (sunrise + HALF - now) / (HALF * 2)
  if (now <= sunset - HALF) return 0
  if (now < sunset + HALF) return (now - (sunset - HALF)) / (HALF * 2)
  return 1
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
  const between = one.map((value, at) => Math.round(value + ((two[at] ?? value) - value) * amount))
  return `#${between.map((value) => value.toString(16).padStart(2, '0')).join('')}`
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
