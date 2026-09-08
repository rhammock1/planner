// @ts-check

/**
 * Where `dusk` thinks the sun is.
 *
 * Checked against published almanac times and against things that are true of
 * the sky everywhere, rather than against a table of expected numbers - a
 * fixture of angles would be a second copy of the equations, wrong in the same
 * places.
 *
 * `solarPosition` takes a local date and time, so a few of these are pinned to
 * a timezone. Those name it, and take the machine's own offset rather than
 * assuming one: this suite runs wherever it runs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { solarPosition, readPlace } from '../plugins/dusk/sun.js'

/** Charlotte, North Carolina, to the two decimal places the bridge hands over. */
const CHARLOTTE = { latitude: 35.23, longitude: -80.84 }
const GREENWICH = { latitude: 51.48, longitude: 0 }

/**
 * The machine's offset from UTC in minutes on a given day, east positive.
 *
 * Asked for rather than assumed, because this suite runs wherever it runs.
 * Taken at midday, so it is the offset actually in force for the day.
 *
 * @param {number} year @param {number} month @param {number} day
 * @returns {number}
 */
function offsetOn(year, month, day) {
  return -new Date(Date.UTC(year, month - 1, day, 12)).getTimezoneOffset()
}

/** `HH:MM` for a minute past local midnight. @param {number} minutes @returns {string} */
function at(minutes) {
  const settled = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(settled / 60)).padStart(2, '0')}:${String(settled % 60).padStart(2, '0')}`
}

/**
 * The altitude at a UTC minute of a day, asked for in the machine's own time.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {number} utcMinutes
 * @param {{latitude: number, longitude: number}} place
 * @returns {number}
 */
function altitudeAtUtc(date, utcMinutes, place) {
  const [year, month, day] = date.split('-').map(Number)
  const local = utcMinutes + offsetOn(year ?? 0, month ?? 1, day ?? 1)
  const sun = solarPosition(date, at(local), place.latitude, place.longitude)
  assert.ok(sun !== null)
  return sun.altitude
}

test('at a published sunrise and sunset the sun is on the horizon', () => {
  // Charlotte, 2026-09-02: sunrise 06:57 and sunset 19:52 EDT, which is 10:57
  // and 23:52 UTC. The sun is then at about -0.83 degrees - the centre of a
  // disc whose top edge is just showing, once the atmosphere has bent it.
  //
  // This is a stronger check than the old one on `sunEvents`: it exercises the
  // hour angle and the local-time conversion as well as the equations, and it
  // is the arithmetic the page actually runs on.
  const morning = altitudeAtUtc('2026-09-02', 10 * 60 + 57, CHARLOTTE)
  const evening = altitudeAtUtc('2026-09-02', 23 * 60 + 52, CHARLOTTE)
  assert.ok(Math.abs(morning + 0.833) < 1.5, `sunrise altitude was ${morning}`)
  assert.ok(Math.abs(evening + 0.833) < 1.5, `sunset altitude was ${evening}`)
})

test('the sun is highest at solar noon, and due south from the north', () => {
  // Solar noon at Charlotte is 12:00 UTC plus four minutes a degree of
  // longitude, less the equation of time - about 17:02 UTC in early September.
  let best = { altitude: -90, azimuth: 0 }
  for (let utc = 15 * 60; utc < 19 * 60; utc += 1) {
    const [year, month, day] = [2026, 9, 2]
    const sun = solarPosition(
      '2026-09-02',
      at(utc + offsetOn(year, month, day)),
      CHARLOTTE.latitude,
      CHARLOTTE.longitude,
    )
    assert.ok(sun !== null)
    if (sun.altitude > best.altitude) best = sun
  }
  // 35.23 north, declination about +7.5 in early September.
  assert.ok(Math.abs(best.altitude - (90 - (35.23 - 7.5))) < 2, `noon altitude ${best.altitude}`)
  assert.ok(Math.abs(best.azimuth - 180) < 2, `noon bearing ${best.azimuth}`)
})

test('the sun rises in the east and sets in the west', () => {
  // Which is the half of the answer `sunEvents` never had, and the half that
  // decides which edge of the page the light comes in from.
  const morning = solarPosition('2026-09-02', at(7 * 60 + 30), CHARLOTTE.latitude, CHARLOTTE.longitude)
  const evening = solarPosition('2026-09-02', at(19 * 60 + 20), CHARLOTTE.latitude, CHARLOTTE.longitude)
  assert.ok(morning !== null && evening !== null)
  assert.ok(morning.azimuth > 45 && morning.azimuth < 135, `morning bearing ${morning.azimuth}`)
  assert.ok(evening.azimuth > 225 && evening.azimuth < 315, `evening bearing ${evening.azimuth}`)
})

test('an equinox is a day of about twelve hours everywhere it has one', () => {
  for (const latitude of [0, 35.23, -35.23, 51.48]) {
    let up = 0
    for (let utc = 0; utc < 1440; utc += 1) {
      if (altitudeAtUtc('2026-03-20', utc, { latitude, longitude: 0 }) > 0) up += 1
    }
    // A little over twelve: the geometric horizon this measures from is the
    // true one, and the sun's own centre crosses it a shade after six.
    assert.ok(up > 715 && up < 730, `${latitude}: ${up} minutes above the horizon`)
  }
})

test('summer is longer than winter, and the two hemispheres disagree about which is which', () => {
  const lengthAt = (/** @type {string} */ date, /** @type {number} */ latitude) => {
    let up = 0
    for (let utc = 0; utc < 1440; utc += 2) {
      if (altitudeAtUtc(date, utc, { latitude, longitude: 0 }) > 0) up += 2
    }
    return up
  }
  assert.ok(lengthAt('2026-06-21', 51.48) > lengthAt('2026-12-21', 51.48))
  assert.ok(lengthAt('2026-06-21', -51.48) < lengthAt('2026-12-21', -51.48))
  // And a day in one is the other's night, within a few minutes.
  const both = lengthAt('2026-06-21', 51.48) + lengthAt('2026-06-21', -51.48)
  assert.ok(Math.abs(both - 1440) < 40, `${both} minutes of daylight between them`)
})

test('inside a polar circle the sun still has an altitude all day', () => {
  // What `sunEvents` had nothing to say about. There is no crossing to
  // interpolate over at Longyearbyen in June or in December, but the sun is
  // somewhere on both days, and it is the answer the page needs: one is a
  // day that never gets dark, the other a night that never gets light.
  let highest = -90
  let lowest = 90
  for (let utc = 0; utc < 1440; utc += 10) {
    const summer = altitudeAtUtc('2026-06-21', utc, { latitude: 78.22, longitude: 15.65 })
    lowest = Math.min(lowest, summer)
  }
  for (let utc = 0; utc < 1440; utc += 10) {
    const winter = altitudeAtUtc('2026-12-21', utc, { latitude: 78.22, longitude: 15.65 })
    highest = Math.max(highest, winter)
  }
  assert.ok(lowest > 0, `midsummer went below the horizon, to ${lowest}`)
  assert.ok(highest < -6, `midwinter reached ${highest}, which is not polar night`)
})

test('solar noon at the prime meridian is noon, give or take the equation of time', () => {
  // Which never exceeds about seventeen minutes, in either direction. A sign
  // error anywhere in the equations shows up here as hours.
  for (const date of ['2026-02-11', '2026-05-14', '2026-07-26', '2026-11-03']) {
    let bestAt = 0
    let best = -90
    for (let utc = 0; utc < 1440; utc += 1) {
      const altitude = altitudeAtUtc(date, utc, GREENWICH)
      if (altitude > best) { best = altitude; bestAt = utc }
    }
    assert.ok(Math.abs(bestAt - 720) < 20, `${date}: solar noon at ${bestAt}`)
  }
})

test('longitude moves noon four minutes a degree, and westward is later', () => {
  let bestAt = 0
  let best = -90
  for (let utc = 0; utc < 1440; utc += 1) {
    const altitude = altitudeAtUtc('2026-09-02', utc, CHARLOTTE)
    if (altitude > best) { best = altitude; bestAt = utc }
  }
  assert.ok(Math.abs(bestAt - (720 + 4 * 80.84)) < 20, `solar noon at ${bestAt}`)
})

test('a moment that cannot be read is not a position', () => {
  // Rather than NaN degrees, which would become a colour built out of it and
  // reach the page as a value it refuses without ever saying why.
  assert.equal(solarPosition('not a date', '19:42', 35.23, -80.84), null)
  assert.equal(solarPosition('2026-09-02', 'evening', 35.23, -80.84), null)
  assert.equal(solarPosition('2026-09-02', '19:42', Number.NaN, -80.84), null)
})

test('a place typed into a settings row', () => {
  assert.deepEqual(readPlace('35.23,-80.84'), { latitude: 35.23, longitude: -80.84 })
  assert.deepEqual(readPlace(' 35.23 , -80.84 '), { latitude: 35.23, longitude: -80.84 })
  assert.equal(readPlace(''), null)
  assert.equal(readPlace('Charlotte'), null)
  assert.equal(readPlace('35.23'), null)
  // A half that is not a number at all. `Number('')` is 0, and 0,0 is a real
  // place, so these have to be refused before the arithmetic sees them.
  assert.equal(readPlace(','), null)
  assert.equal(readPlace(' , '), null)
  assert.equal(readPlace('35.23,'), null)
  // Off the planet.
  assert.equal(readPlace('95,0'), null)
  assert.equal(readPlace('0,200'), null)
  // And 0,0 typed on purpose is still a place.
  assert.deepEqual(readPlace('0,0'), { latitude: 0, longitude: 0 })
})
