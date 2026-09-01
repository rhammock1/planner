// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { SOMEDAY, buildIndex } from '../src/core/vaultIndex.js'
import { schedule, upcoming } from '../src/core/schedule.js'
import { instantAt } from '../src/clock.js'

const TODAY = '2026-08-31'

/**
 * @param {Record<string, string>} pages page key -> file text
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function vault(pages) {
  return buildIndex(Object.entries(pages).map(([page, text]) => ({ page, doc: parse(text) })))
}

/**
 * @param {string} body item lines for today
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function today(body) {
  return vault({ [TODAY]: `# ${TODAY}\n\n${body}` })
}

/** @param {ReturnType<typeof schedule>} alarms */
const said = (alarms) => alarms.map((alarm) => `${alarm.time} ${alarm.text}`)

describe('what gets an alarm', () => {
  test('an open line with a time', () => {
    assert.deepEqual(said(schedule(today('- [ ] Standup @09:30\n'), TODAY)), ['09:30 Standup'])
  })

  test('a line with no time gets none', () => {
    assert.deepEqual(schedule(today('- [ ] Order the connectors\n'), TODAY), [])
  })

  test('a day with no file gets none', () => {
    assert.deepEqual(schedule(vault({}), TODAY), [])
  })

  // Being reminded of something you have already done is the app arguing
  // with the page.
  test('a line already ticked off gets none', () => {
    assert.deepEqual(schedule(today('- [x] Standup @09:30\n'), TODAY), [])
  })

  test('a line crossed out gets none', () => {
    assert.deepEqual(schedule(today('- [-] Standup @09:30\n'), TODAY), [])
  })

  // The copy on the other day carries the time, and would be announced there.
  test('a line carried forward gets none', () => {
    assert.deepEqual(schedule(today('- [>] Standup @09:30 >2026-09-01\n'), TODAY), [])
  })

  test('lines the parser did not understand get none', () => {
    assert.deepEqual(schedule(today('some hand-written note @09:30\n'), TODAY), [])
  })

  test('a timed line on another day is not today\'s business', () => {
    const index = vault({ '2026-09-04': '# 2026-09-04\n\n- [ ] Dentist @11:00\n' })
    assert.deepEqual(schedule(index, TODAY), [])
  })

  test('a timed line on the back page is not an appointment', () => {
    const index = vault({ [SOMEDAY]: '# Someday\n\n- [ ] Ring the bank @11:00\n' })
    assert.deepEqual(schedule(index, TODAY), [])
  })

  test('earliest first, whatever order the page is in', () => {
    const index = today('- [ ] Retro @16:00\n- [ ] Standup @09:30\n- [ ] Lunch @12:15\n')
    assert.deepEqual(said(schedule(index, TODAY)), ['09:30 Standup', '12:15 Lunch', '16:00 Retro'])
  })

  test('two lines at the same time keep the order the page has them in', () => {
    const index = today('- [ ] Retro @16:00\n- [ ] Handover @16:00\n')
    assert.deepEqual(said(schedule(index, TODAY)), ['16:00 Retro', '16:00 Handover'])
  })
})

describe('what is still ahead', () => {
  const at = (/** @type {string} */ time) => Number(time.replace(':', ''))

  test('an alarm still to come is kept', () => {
    const kept = upcoming([{ time: '16:00', text: 'Retro' }], at, 1200)
    assert.deepEqual(kept, [{ at: 1600, text: 'Retro', time: '16:00' }])
  })

  // Re-sending one already gone is how a set recomputed mid-morning would
  // ring the nine o'clock alarm a second time.
  test('an alarm whose moment has gone is dropped', () => {
    assert.deepEqual(upcoming([{ time: '09:30', text: 'Standup' }], at, 1200), [])
  })

  test('an alarm at exactly this moment is gone, not ahead', () => {
    assert.deepEqual(upcoming([{ time: '12:00', text: 'Lunch' }], at, 1200), [])
  })
})

describe('turning a time into a moment', () => {
  test('an hour apart is an hour apart', () => {
    assert.equal(instantAt(TODAY, '10:30') - instantAt(TODAY, '09:30'), 3_600_000)
  })

  test('the moment reads back as the time that was asked for', () => {
    const when = new Date(instantAt(TODAY, '09:30'))
    assert.equal(when.getHours(), 9)
    assert.equal(when.getMinutes(), 30)
    assert.equal(when.getDate(), 31)
  })

  test('nonsense throws rather than becoming an alarm at the epoch', () => {
    assert.throws(() => instantAt('not-a-date', '09:30'), RangeError)
  })
})
