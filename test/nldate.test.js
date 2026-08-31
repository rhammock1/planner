// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseEntry } from '../src/core/nldate.js'

// A Monday, chosen so every weekday case has an unambiguous answer.
const TODAY = '2026-08-31'

/**
 * @param {string} input
 * @returns {{text: string, date: string|null, time: string|null, due: string|null}}
 */
const entry = (input) => parseEntry(input, TODAY)

describe('dates', () => {
  /** @type {[string, string][]} */
  const cases = [
    ['today', TODAY],
    ['tomorrow', '2026-09-01'],
    ['monday', '2026-09-07'],
    ['tuesday', '2026-09-01'],
    ['sunday', '2026-09-06'],
    ['mon', '2026-09-07'],
    ['fri', '2026-09-04'],
    ['tues', '2026-09-01'],
    ['thurs', '2026-09-03'],
    ['in 3 days', '2026-09-03'],
    ['in 1 day', '2026-09-01'],
    ['9/2', '2026-09-02'],
    ['12/25', '2026-12-25'],
    ['2026-09-02', '2026-09-02'],
    ['sep 2', '2026-09-02'],
    ['september 2', '2026-09-02'],
  ]

  for (const [phrase, expected] of cases) {
    test(`"${phrase}" is ${expected}`, () => {
      const result = entry(`dentist ${phrase}`)
      assert.equal(result.date, expected)
      assert.equal(result.text, 'dentist')
    })
  }

  test('case does not matter', () => {
    assert.equal(entry('dentist Tomorrow').date, '2026-09-01')
    assert.equal(entry('dentist FRIDAY').date, '2026-09-04')
  })

  test('a phrase is lifted out of the middle of a line', () => {
    const result = entry('call the vet tomorrow about the food')
    assert.equal(result.date, '2026-09-01')
    assert.equal(result.text, 'call the vet about the food')
  })

  test('a phrase at the start is lifted too', () => {
    assert.deepEqual(entry('tomorrow call the vet'), {
      text: 'call the vet', date: '2026-09-01', time: null, due: null,
    })
  })

  // A day-of-year that has already gone by means the one coming up. Typing
  // "12/25" in December must not file the entry eleven months into the past.
  test('a month and day already past roll into next year', () => {
    assert.equal(entry('dentist 1/5').date, '2027-01-05')
    assert.equal(entry('dentist jan 5').date, '2027-01-05')
  })

  test('a month and day landing on today is today', () => {
    assert.equal(entry('dentist 8/31').date, TODAY)
  })

  // An explicit ISO date is a statement, not a guess. It is taken as written
  // even when it is in the past - that is how a note gets filed on the day it
  // belongs to.
  test('an explicit past date is taken as written', () => {
    assert.equal(entry('dentist 2020-01-01').date, '2020-01-01')
  })

  test('the first date phrase in the line wins', () => {
    assert.equal(entry('tomorrow and also monday').date, '2026-09-01')
  })
})

describe('times', () => {
  /** @type {[string, string][]} */
  const cases = [
    ['8:40', '08:40'],
    ['08:40', '08:40'],
    ['8:40am', '08:40'],
    ['8:40 pm', '20:40'],
    ['4pm', '16:00'],
    ['4 PM', '16:00'],
    ['12pm', '12:00'],
    ['12am', '00:00'],
    ['at 4', '16:00'],
    ['at 9', '09:00'],
    ['at 10:30', '10:30'],
    ['at 4pm', '16:00'],
    ['23:15', '23:15'],
  ]

  for (const [phrase, expected] of cases) {
    test(`"${phrase}" is ${expected}`, () => {
      const result = entry(`standup ${phrase}`)
      assert.equal(result.time, expected)
      assert.equal(result.text, 'standup')
    })
  }

  // A planner is written during waking hours. An unqualified 4 means the
  // afternoon; an unqualified 9 means the morning. The quick-add preview
  // (spec §5.2) shows the choice before it is committed.
  test('an unqualified hour of 1 to 6 is the afternoon', () => {
    assert.equal(entry('gym 5:30').time, '17:30')
    assert.equal(entry('call at 1').time, '13:00')
    assert.equal(entry('call at 6').time, '18:00')
    assert.equal(entry('standup at 7').time, '07:00')
  })

  test('a date and a time can appear together', () => {
    assert.deepEqual(entry('pair with Dana tomorrow at 10:30'), {
      text: 'pair with Dana', date: '2026-09-01', time: '10:30', due: null,
    })
  })
})

describe('due dates', () => {
  test('"by" and "due" both set a deadline', () => {
    assert.equal(entry('firmware sign-off by friday').due, '2026-09-04')
    assert.equal(entry('firmware sign-off due sep 2').due, '2026-09-02')
  })

  test('the deadline is lifted out with its keyword', () => {
    assert.equal(entry('firmware sign-off by friday').text, 'firmware sign-off')
    assert.equal(entry('firmware sign-off due sep 2').text, 'firmware sign-off')
  })

  // "by friday" must be read as a deadline, not as the day the item lands on.
  test('a deadline does not also become the day', () => {
    const result = entry('firmware sign-off by friday')
    assert.equal(result.date, null)
  })

  test('a day and a deadline can appear together', () => {
    assert.deepEqual(entry('start the checklist tomorrow due 2026-09-10'), {
      text: 'start the checklist', date: '2026-09-01', time: null, due: '2026-09-10',
    })
  })
})

describe('what must stay literal', () => {
  /** @type {string[]} */
  const cases = [
    'review PR #4412',
    'buy 4 bolts',
    'order 12 screws',
    'read chapter 8',
    'email dana@gotab.io',
    'fix the 500 error',
    'ping the 2026 planning doc',
    'bump to v2.4',
    'call mondays crew',
    'sat with the team',
    'sun in my eyes',
    'wed the deadline',
    'that is due diligence',
  ]

  for (const input of cases) {
    test(`"${input}" is left alone`, () => {
      assert.deepEqual(parseEntry(input, TODAY), {
        text: input, date: null, time: null, due: null,
      })
    })
  }

  test('an impossible date stays part of the text', () => {
    assert.deepEqual(entry('order 13/45 widgets'), {
      text: 'order 13/45 widgets', date: null, time: null, due: null,
    })
    assert.equal(entry('deploy 2026-02-30').date, null)
  })

  test('an impossible time stays part of the text', () => {
    assert.equal(entry('run 25:00').time, null)
    assert.equal(entry('run 10:99').time, null)
    assert.equal(entry('run 10:99').text, 'run 10:99')
  })

  test('a bare number is not a time without "at"', () => {
    assert.equal(entry('review 4').time, null)
  })
})

describe('the leftover text', () => {
  test('an entry that is only a phrase leaves nothing behind', () => {
    assert.equal(entry('tomorrow').text, '')
  })

  test('surrounding whitespace is tidied but internal text is not', () => {
    const result = entry('  pair  with   Dana tomorrow  ')
    assert.equal(result.text, 'pair  with   Dana')
  })

  test('an empty line parses to an empty entry', () => {
    assert.deepEqual(parseEntry('', TODAY), {
      text: '', date: null, time: null, due: null,
    })
  })
})
