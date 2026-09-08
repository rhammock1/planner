// @ts-check

/**
 * `dusk`'s arithmetic, which is the whole of it.
 *
 * Everything here is in UTC minutes on purpose: a test that asserted a local
 * time would pass on the author's machine and fail on a build box, and what is
 * being checked is the NOAA equations rather than anybody's timezone.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  sunEvents, localMinutes, minutesOf, warmthAt, mix, shifted, readPlace,
} from '../plugins/dusk/sun.js'

/** Charlotte, North Carolina, to the two decimal places the bridge hands over. */
const CHARLOTTE = { latitude: 35.23, longitude: -80.84 }

test('a written-down time is minutes past midnight', () => {
  assert.equal(minutesOf('00:00'), 0)
  assert.equal(minutesOf('19:42'), 19 * 60 + 42)
  assert.equal(minutesOf('23:59'), 1439)
})

test('a UTC minute before or after the day still lands on the right local time', () => {
  // The one function here that knows about timezones, and the one whose input
  // routinely falls outside [0, 1440): west of Greenwich sunset is past 1440,
  // far enough east sunrise is negative. Both have to roll the date rather
  // than being clamped or wrapped in place.
  //
  // The offset is asked for rather than assumed, because this suite runs
  // wherever it runs. Taken at midday UTC on the day in question, so it is the
  // offset actually in force for every instant below.
  const offset = -new Date(Date.UTC(2026, 8, 2, 12)).getTimezoneOffset()
  /** @param {number} utc */
  const expected = (utc) => (((utc + offset) % 1440) + 1440) % 1440

  assert.equal(localMinutes('2026-09-02', 600), expected(600))
  // Charlotte's sunset that day, in UTC minutes from its own midnight.
  assert.equal(localMinutes('2026-09-02', 1430), expected(1430))
  // And the two that leave the day at either end.
  assert.equal(localMinutes('2026-09-02', 1500), expected(1500))
  assert.equal(localMinutes('2026-09-02', -380), expected(-380))
  // A date it cannot read is nought rather than a NaN that spreads.
  assert.equal(localMinutes('the second', 600), 0)
})

test('the sun rises before it sets', () => {
  // And only that. `sunEvents` answers in UTC minutes from the *date's*
  // midnight, with no wrap: Charlotte's sunset is 1429, and a few degrees
  // further west it is past 1440 - which is correct, and `localMinutes` is
  // built to roll the date. A test asserting `< 1440` here would fail one day
  // for a reason that is not a bug.
  const events = sunEvents('2026-09-02', CHARLOTTE.latitude, CHARLOTTE.longitude)
  assert.ok(events !== null)
  assert.ok(events.sunrise < events.sunset)
})

test('a known day in a known place, to within ten minutes', () => {
  // Published: Charlotte, 2026-09-02, sunrise 06:57 and sunset 19:52 EDT,
  // which is 10:57 and 23:52 UTC. Ten minutes of slack, because this is a
  // check on the equations rather than on the almanac.
  const events = sunEvents('2026-09-02', CHARLOTTE.latitude, CHARLOTTE.longitude)
  assert.ok(events !== null)
  assert.ok(Math.abs(events.sunrise - (10 * 60 + 57)) < 10, `sunrise was ${events.sunrise}`)
  assert.ok(Math.abs(events.sunset - (23 * 60 + 52)) < 10, `sunset was ${events.sunset}`)
})

test('solar noon at the prime meridian is noon, give or take the equation of time', () => {
  // Which never exceeds about seventeen minutes, in either direction. A sign
  // error anywhere in the equations shows up here as hours.
  for (const date of ['2026-02-11', '2026-05-14', '2026-07-26', '2026-11-03']) {
    const events = sunEvents(date, 51.48, 0)
    assert.ok(events !== null, date)
    const noon = (events.sunrise + events.sunset) / 2
    assert.ok(Math.abs(noon - 720) < 20, `${date}: solar noon at ${noon}`)
  }
})

test('longitude moves noon four minutes a degree, and westward is later', () => {
  const events = sunEvents('2026-09-02', CHARLOTTE.latitude, CHARLOTTE.longitude)
  assert.ok(events !== null)
  const noon = (events.sunrise + events.sunset) / 2
  assert.ok(Math.abs(noon - (720 + 4 * 80.84)) < 20, `solar noon at ${noon}`)
})

test('an equinox is a day of about twelve hours everywhere it has one', () => {
  // A little over twelve: sunrise is measured to the top of a refracted disc,
  // not to the centre of a geometric one, which is what the 90.833° is. The
  // lower bound is above 720 on purpose - a horizon of a flat 90° would give
  // almost exactly twelve hours, and a band that admitted it would not be
  // checking the refraction it says it is checking.
  for (const latitude of [0, 35.23, -35.23, 51.48]) {
    const events = sunEvents('2026-03-20', latitude, 0)
    assert.ok(events !== null, `${latitude}`)
    const length = events.sunset - events.sunrise
    assert.ok(length > 723 && length < 735, `${latitude}: ${length} minutes`)
  }
})

test('summer is longer than winter, and the two hemispheres disagree about which is which', () => {
  const lengthAt = (/** @type {string} */ date, /** @type {number} */ latitude) => {
    const events = sunEvents(date, latitude, 0)
    assert.ok(events !== null)
    return events.sunset - events.sunrise
  }
  assert.ok(lengthAt('2026-06-21', 51.48) > lengthAt('2026-12-21', 51.48))
  assert.ok(lengthAt('2026-06-21', -51.48) < lengthAt('2026-12-21', -51.48))
  // And a day in one is the other's night, within a few minutes.
  const both = lengthAt('2026-06-21', 51.48) + lengthAt('2026-06-21', -51.48)
  assert.ok(Math.abs(both - 1440) < 40, `${both} minutes of daylight between them`)
})

test('a sun that does not set has no sunset to interpolate over', () => {
  assert.equal(sunEvents('2026-06-21', 78.22, 15.65), null)
  assert.equal(sunEvents('2026-12-21', 78.22, 15.65), null)
})

test('a day that is not a day is not a date', () => {
  assert.equal(sunEvents('not a date', 0, 0), null)
})

test('warmth is nought in daylight, one at night, and a ramp of an hour between', () => {
  const sunrise = 7 * 60
  const sunset = 20 * 60
  assert.equal(warmthAt(12 * 60, sunrise, sunset), 0)
  assert.equal(warmthAt(3 * 60, sunrise, sunset), 1)
  assert.equal(warmthAt(23 * 60, sunrise, sunset), 1)

  // Half an hour either side of the event, so a pinned page takes four steps
  // across it: at -30, -15, 0, +15 and +30.
  assert.equal(warmthAt(sunset - 30, sunrise, sunset), 0)
  assert.equal(warmthAt(sunset, sunrise, sunset), 0.5)
  assert.equal(warmthAt(sunset + 30, sunrise, sunset), 1)
  assert.equal(warmthAt(sunrise - 30, sunrise, sunset), 1)
  assert.equal(warmthAt(sunrise, sunrise, sunset), 0.5)
  assert.equal(warmthAt(sunrise + 30, sunrise, sunset), 0)
})

test('warmth only ever goes one way across an event', () => {
  const sunrise = 7 * 60
  const sunset = 20 * 60
  let last = warmthAt(sunset - 45, sunrise, sunset)
  for (let at = sunset - 30; at <= sunset + 45; at += 5) {
    const now = warmthAt(at, sunrise, sunset)
    assert.ok(now >= last, `warmth fell at ${at}`)
    last = now
  }
})

test('a place whose sunset falls after local midnight still has a daytime', () => {
  // Nome, Alaska at midsummer: local sunrise 04:19 and local sunset 01:47, so
  // sunset is the *smaller* number. Read as an interval between two numbers
  // every comparison falls through and the answer is 1 at every hour - noon
  // in the full night palette, all day, with no time that recovers. The clock
  // is a circle, and this is the test that says so.
  const sunrise = 4 * 60 + 19
  const sunset = 1 * 60 + 47
  assert.ok(sunset < sunrise, 'the fixture has stopped being the awkward case')

  assert.equal(warmthAt(12 * 60, sunrise, sunset), 0, 'midsummer noon was dark')
  assert.equal(warmthAt(18 * 60, sunrise, sunset), 0)
  assert.equal(warmthAt(23 * 60, sunrise, sunset), 0)
  // Night is the short arc from sunset round to sunrise.
  assert.equal(warmthAt(3 * 60, sunrise, sunset), 1)
  // And both events still ramp, in the right direction.
  assert.equal(warmthAt(sunset, sunrise, sunset), 0.5)
  assert.equal(warmthAt(sunrise, sunrise, sunset), 0.5)
  assert.ok(warmthAt(sunset + 20, sunrise, sunset) > warmthAt(sunset - 20, sunrise, sunset))
  assert.ok(warmthAt(sunrise + 20, sunrise, sunset) < warmthAt(sunrise - 20, sunrise, sunset))
})

test('a colour moves the way the reference pair moves, whatever theme it came from', () => {
  // What lets one plugin warm a theme it has never seen. On the reference
  // theme the transformation lands exactly on the reference destination, so
  // nothing about Ledger changes; on a dark theme it warms without lightening.
  assert.equal(shifted('#FBFAF6', '#FBFAF6', '#F6EEDD'), '#f6eedd')
  assert.equal(shifted('#23262A', '#23262A', '#2A2622'), '#2a2622')

  // A dark theme's paper stays dark - the giveaway that this is a ratio and
  // not a difference, which would have lightened it toward Ledger's cream.
  const dark = shifted('#141414', '#FBFAF6', '#F6EEDD')
  assert.ok(dark < '#202020', `a dark paper became ${dark}`)

  // And a channel cannot leave the byte it lives in.
  assert.equal(shifted('#EEEEEE', '#23262A', '#2A2622').slice(1, 3), 'ff')
  assert.equal(shifted('#000000', '#FBFAF6', '#F6EEDD'), '#000000')
})

test('a colour between two colours', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0), '#000000')
  assert.equal(mix('#000000', '#FFFFFF', 1), '#ffffff')
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080')
  assert.equal(mix('#FBFAF6', '#F6EEDD', 0), '#fbfaf6')
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
