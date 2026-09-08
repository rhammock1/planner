// @ts-check

/**
 * Where the sun is, for a moment and a place.
 *
 * The NOAA general solar position equations, which is the whole reason this
 * plugin needs no network: the sun's altitude and bearing are arithmetic on a
 * date, a time and two numbers. This is the precedent for the next plugin that
 * thinks it needs `net.fetch` - it probably needs a setting.
 *
 * **Altitude, not sunrise and sunset.** Version 0.1.0 worked out the two
 * crossing times and interpolated a ramp over the hour either side of each.
 * That is more code and less answer:
 *
 * - The clock is a circle and the ramp had to know it. Anywhere local sunset
 *   falls after local midnight - western Alaska, and anywhere sitting far
 *   enough west inside its timezone - `sunset < sunrise` as numbers, and read
 *   as an interval the answer came out as night at every hour of the day. An
 *   altitude is a number, not an interval between two events on a wrapping
 *   dial, and has no such case.
 * - Inside either polar circle there are no crossings, and 0.1.0 had nothing
 *   honest to say about a day with none. An altitude is defined every day of
 *   the year: in polar night the sun never clears -6 degrees and the page is a
 *   night page for months, which is not a degenerate case. It is Svalbard in
 *   January.
 * - And a bearing falls out of the same arithmetic, which is what lets the
 *   light arrive from the edge the sun is actually behind.
 *
 * Its own file so that it can be tested by `node --test` with no `planner`
 * object in the room. Nothing here touches the API; `index.js` is the half
 * that does.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^(\d{2}):(\d{2})$/

/**
 * The sun's altitude above the horizon and its bearing, in degrees.
 *
 * Altitude is geometric - the centre of the disc, no refraction - so the
 * horizon it is measured from is the true one rather than the apparent one.
 * The difference is about half a degree and this plugin is choosing colours,
 * not timing a transit.
 *
 * Bearing is the compass one: 0 is north, 90 east, 180 south, 270 west.
 *
 * `null` for a moment that cannot be read. The host writes both of these, so
 * in practice that never happens - but a plugin that returned NaN degrees
 * would answer with a colour built out of it, and `#NaNNaNNaN` is a value the
 * page would refuse without ever saying why.
 *
 * @param {string} date `YYYY-MM-DD`, local
 * @param {string} time `HH:MM`, local, 24-hour
 * @param {number} latitude  degrees, north positive
 * @param {number} longitude  degrees, east positive
 * @returns {{altitude: number, azimuth: number}|null}
 */
export function solarPosition(date, time, latitude, longitude) {
  const at = instant(date, time)
  if (at === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  // Julian day straight off the instant. `Date` counts milliseconds from
  // 1970-01-01T00:00Z and the Julian day of that moment is 2440587.5, so the
  // Gregorian conversion the old code carried is a calculation of something
  // already known exactly.
  const day = at.getTime() / 86400000 + 2440587.5
  const t = (day - 2451545) / 36525

  // Geometric mean longitude and anomaly of the sun, in degrees.
  const meanLongitude = 280.46646 + t * (36000.76983 + t * 0.0003032)
  const anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)

  const centre =
    Math.sin(rad(anomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * anomaly)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * anomaly)) * 0.000289

  // The longitude of the ascending node of the moon's orbit, which is what
  // both the aberration correction and the tilt's nutation term are measured
  // against. Named because it appears in both, and a pair of magic numbers
  // that must stay equal is a pair that will not.
  const node = rad(125.04 - 1934.136 * t)

  // The apparent longitude: the true one, less aberration and nutation.
  const apparent = meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(node)

  const meanTilt =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const tilt = meanTilt + 0.00256 * Math.cos(node)

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

  // Apparent solar time at this longitude, and the hour angle from it: four
  // minutes a degree, negative before local noon and positive after.
  const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60
  const solarTime = wrap(utcMinutes + equation + 4 * longitude, 1440)
  const hourAngle = solarTime / 4 - 180

  const cosine =
    Math.sin(rad(latitude)) * Math.sin(declination) +
    Math.cos(rad(latitude)) * Math.cos(declination) * Math.cos(rad(hourAngle))
  const zenith = Math.acos(clamped(cosine))

  return {
    altitude: 90 - deg(zenith),
    azimuth: bearing(latitude, declination, zenith, hourAngle),
  }
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
 * The compass bearing of the sun, 0 north through 270 west.
 *
 * `acos` only ever answers between 0 and 180, so it cannot tell morning from
 * afternoon on its own; the hour angle is what decides which side of the
 * meridian the answer belongs on.
 *
 * @param {number} latitude  degrees
 * @param {number} declination  radians
 * @param {number} zenith  radians
 * @param {number} hourAngle  degrees
 * @returns {number} 0 to 360
 */
function bearing(latitude, declination, zenith, hourAngle) {
  const below = Math.cos(rad(latitude)) * Math.sin(zenith)
  // The sun straight overhead or straight underfoot has no bearing at all.
  // South is as good an answer as any, and it is the one the next line would
  // have given for every other moment of that day.
  if (Math.abs(below) < 1e-9) return 180
  const cosine = (Math.sin(rad(latitude)) * Math.cos(zenith) - Math.sin(declination)) / below
  const from = deg(Math.acos(clamped(cosine)))
  return hourAngle > 0 ? wrap(from + 180, 360) : wrap(540 - from, 360)
}

/**
 * The instant a local date and time fall at.
 *
 * `Date` with separate arguments builds in local time, which is what makes
 * this correct across a daylight saving change - and it is the one thing spec
 * §1.1 allows `Date` for: the rule is about a plugin not holding a clock of
 * its own, not about a plugin never reading one.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {string} time `HH:MM`
 * @returns {Date|null}
 */
function instant(date, time) {
  const day = DATE.exec(date)
  const clock = TIME.exec(time)
  if (day === null || clock === null) return null
  const at = new Date(
    Number(day[1]), Number(day[2]) - 1, Number(day[3]),
    Number(clock[1]), Number(clock[2]), 0, 0,
  )
  return Number.isNaN(at.getTime()) ? null : at
}

/** @param {number} value @param {number} period @returns {number} */
function wrap(value, period) {
  return ((value % period) + period) % period
}

/** @param {number} value @returns {number} */
function clamped(value) {
  return Math.max(-1, Math.min(1, value))
}

/** @param {number} degrees @returns {number} */
function rad(degrees) {
  return (degrees * Math.PI) / 180
}

/** @param {number} radians @returns {number} */
function deg(radians) {
  return (radians * 180) / Math.PI
}
