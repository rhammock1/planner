// @ts-check

/**
 * The day page's layout, which only a browser can measure.
 *
 * A page with more lines than fit used to grow past the bottom of the window,
 * taking the footer - the day/week/month tabs and the count - somewhere no
 * scrollbar could reach. The list is what gives, and the frame around it
 * stays put.
 */

import { check, ok, equal, report } from './harness.js'
import { parse } from '../../src/core/parse.js'
import * as dayPage from '../../src/views/dayPage.js'
import { buildIndex } from '../../src/core/vaultIndex.js'
import { search as searchVault } from '../../src/core/search.js'
import { DAY_VIEW } from '../../src/views/dayFooter.js'
import { cardMarkKey } from '../../src/core/board.js'

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

/** The block the last press of a meeting's note control asked to open.
 *  @type {import('../../src/core/sections.js').Block|null} */
let opened = null

/** The view the last press of a footer tab asked for. @type {string|null} */
let went = null

/**
 * @param {number} count
 * @returns {string}
 */
function pageOf(count) {
  const lines = []
  for (let at = 1; at <= count; at += 1) lines.push(`- [ ] Line number ${at}`)
  return `# 2026-09-01\n\n${lines.join('\n')}\n\n---\n\nHow it went.\n`
}

/**
 * @param {number} count
 * @param {number} [events]  how many a plugin contributed
 * @param {string[]} [notices]
 * @param {import('../../src/views/notices.js').Action[]} [actions]
 * @param {import('../../src/core/box.js').Box|null} [box]  a plugin's picture
 * @returns {void}
 */
function show(count, events, notices, actions, box) {
  const vault = buildIndex([{ page: '2026-09-01', doc: parse(pageOf(count)) }])
  stage.replaceChildren()
  const root = document.createElement('main')
  root.id = 'app'
  stage.append(root)

  dayPage.mount(root, {
    onNavigate: () => {},
    onToggle: () => {},
    onEdit: async () => true,
    onNote: async () => true,
    onStrike: () => {},
    onRemove: async () => true,
    onBadge: () => {},
    onDailyNote: async () => true,
    onOpenSidecar: (block) => { opened = block },
    onAdd: async () => true,
    onCarry: () => {},
    onPin: () => {},
    onView: (next) => { went = next },
    onCard: () => {},
    onFinish: () => {},
    onSearch: (query) => searchVault(vault, query),
    onProviders: () => ({ groups: [], notices: [] }),
    onJump: () => {},
    onFollow: () => {},
    note: {
      onWrite: async () => true,
      onDelete: async () => true,
      onFollow: () => {},
      onOpenLink: () => {},
      onClose: () => {},
    },
    settings: { onChange: () => {}, onPlugin: () => {}, onChooseVault: () => {} },
  })
  dayPage.render({
    today: '2026-09-01',
    page: '2026-09-01',
    view: DAY_VIEW,
    tabs: [],
    boards: [],
    doc: parse(pageOf(count)),
    horizon: [],
    carry: [],
    sections: (events ?? 0) === 0 ? [] : [{
      plugin: 'macos-calendar',
      heading: 'On the calendar',
      events: Array.from({ length: events ?? 0 }, (_, at) => ({
        time: `${String(9 + at).padStart(2, '0')}:00`,
        text: `Meeting number ${at + 1}`,
      })),
    }],
    blocks: [],
    prefixes: new Map(),
    box: box ?? null,
    notices: notices ?? [],
    actions: actions ?? [],
  })
}

/** @type {import('../../src/core/config.js').Config} */
const SETTINGS_CONFIG = {
  vault: '~/Planner',
  theme: 'ledger',
  hotkey: 'Alt+Space',
  horizonLeadDays: 7,
  carryForwardScanDays: 30,
  menuBarCount: true,
  menuBarHorizonDot: true,
  editor: '',
  plugins: new Map(),
}

/** @returns {import('../../src/views/dayPage.js').DayHandlers} */
function handlersFor() {
  return {
    onNavigate: () => {},
    onToggle: () => {},
    onEdit: async () => true,
    onNote: async () => true,
    onStrike: () => {},
    onRemove: async () => true,
    onBadge: () => {},
    onDailyNote: async () => true,
    onOpenSidecar: () => {},
    onAdd: async () => true,
    onCarry: () => {},
    onPin: () => {},
    onView: (next) => { went = next },
    onCard: () => {},
    onFinish: () => {},
    onSearch: () => ({ groups: [], found: 0 }),
    onProviders: () => ({ groups: [], notices: [] }),
    onJump: () => {},
    onFollow: () => {},
    note: {
      onWrite: async () => true,
      onDelete: async () => true,
      onFollow: () => {},
      onOpenLink: () => {},
      onClose: () => {},
    },
    settings: { onChange: () => {}, onPlugin: () => {}, onChooseVault: () => {} },
  }
}

/**
 * @param {string} selector
 * @returns {HTMLElement}
 */
function part(selector) {
  const element = stage.querySelector(selector)
  if (!(element instanceof HTMLElement)) throw new Error(`no ${selector}`)
  return element
}

check('a short day fits without scrolling', () => {
  show(3)
  const items = part('.items')
  ok(items.scrollHeight <= items.clientHeight, 'a three-line day was made to scroll')
})

// The other half of filling the window: on a day with two lines on it the
// footer belongs at the bottom of the page, not floating a third of the way
// down with the window's transparent background showing under it.
check('a short day still puts the footer at the bottom', () => {
  show(3)
  const foot = part('.page-foot').getBoundingClientRect()
  const window = stage.getBoundingClientRect()
  ok(
    Math.abs(foot.bottom - window.bottom) <= 1,
    `the footer floats at ${Math.round(foot.bottom)} in a window ending at ${Math.round(window.bottom)}`,
  )
})

// The bug: twelve lines is an ordinary Tuesday, and it pushed the footer off
// the bottom of a 560pt window where nothing could scroll it back.
check('a long day keeps the page inside the window', () => {
  show(20)
  equal(Math.round(part('.page').getBoundingClientRect().height), 560, 'the page grew past the window')
})

check('the footer stays reachable however long the day is', () => {
  show(20)
  const foot = part('.page-foot')
  ok(
    foot.getBoundingClientRect().bottom <= stage.getBoundingClientRect().bottom + 1,
    `the footer sits at ${Math.round(foot.getBoundingClientRect().bottom)}, past the window`,
  )
})

check('the add row and the day s note stay reachable too', () => {
  show(20)
  const bottom = stage.getBoundingClientRect().bottom + 1
  ok(part('.add').getBoundingClientRect().bottom <= bottom, 'the add row was pushed off')
  ok(part('.note').getBoundingClientRect().bottom <= bottom, 'the day’s note was pushed off')
})

check('the list is what gives, and it scrolls', () => {
  show(20)
  const items = part('.items')
  ok(items.scrollHeight > items.clientHeight, 'the list did not become scrollable')

  items.scrollTop = items.scrollHeight
  const last = [...items.querySelectorAll('.item')].pop()
  ok(last instanceof HTMLElement, 'no last line')
  ok(
    last.getBoundingClientRect().bottom <= items.getBoundingClientRect().bottom + 1,
    'the last line cannot be scrolled to',
  )
})

// The day's own line is written in, not just displayed. It was rendered from
// the file and hidden when empty, which left no way to start one.
check('the day s note can be typed into', () => {
  show(3)
  const note = part('.note')
  equal(note.getAttribute('contenteditable'), 'plaintext-only', 'the note is read-only')
  note.focus()
  equal(document.activeElement, note, 'the note does not take focus')
})

check('an empty day still offers its note', () => {
  show(0)
  const note = part('.note')
  ok(!note.hidden, 'the note is hidden on a day with nothing on it')
})


// What a plugin contributed goes under the list and above the day's own note,
// and is subject to the same rule as everything else on this page: the list is
// what gives, and the frame around it stays put (addendum §1).

check('a day with nothing contributed shows no section at all', () => {
  show(3)
  // The stack, not a section: with nothing contributed there is no section to
  // find, and the thing that has to be out of the way is what holds them.
  const given = stage.querySelector('.givens')
  ok(given instanceof HTMLElement, 'the stack is missing from the page')
  ok(given.hidden, 'an empty stack was left on the page')
  equal(given.getBoundingClientRect().height, 0, 'an empty stack still took up room')
  equal(stage.querySelectorAll('.given').length, 0, 'a section was drawn for a plugin with nothing')
})

check('contributed events appear under the list and above the note', () => {
  show(3, 2)
  // The day's own parts are gathered in `.day-body` now, so a board can take
  // their place rather than sit under them (spec §1). What is between the
  // header and the footer is the day or the board, and never both.
  const page = [...stage.querySelectorAll('.page > *')].map((part) => part.className)
  equal(page.join(' '), 'page-head notice-band day-body view board stacked page-foot search settings note-view', 'the page is in the wrong order')

  const body = [...stage.querySelectorAll('.day-body > *')].map((part) => part.className)
  equal(body.join(' '), 'carry horizon items add day-sections note-row evidence', 'the section is in the wrong place')
  equal(stage.querySelectorAll('.given-item').length, 2, 'the events did not appear')
})

check('a busy day of meetings does not push the footer off', () => {
  show(3, 14)
  const foot = stage.querySelector('.page-foot')
  ok(foot instanceof HTMLElement, 'no footer')
  ok(
    foot.getBoundingClientRect().bottom <= stage.getBoundingClientRect().bottom + 1,
    `fourteen meetings put the footer at ${Math.round(foot.getBoundingClientRect().bottom)}`,
  )
})

// The section gets a few lines and scrolls past them, the way the daily note
// does. A calendar is not what this page is for.
check('a busy day of meetings scrolls inside its own section', () => {
  show(3, 14)
  const list = stage.querySelector('.given-list')
  ok(list instanceof HTMLElement, 'no list')
  ok(list.scrollHeight > list.clientHeight, 'the section grew instead of scrolling')
})

check('the list is still what gives when both are long', () => {
  show(20, 14)
  const items = stage.querySelector('.items')
  ok(items instanceof HTMLElement, 'no list')
  ok(items.scrollHeight > items.clientHeight, 'the item list stopped scrolling')
  equal(Math.round(part('.page').getBoundingClientRect().height), 560, 'the page grew past the window')
})

// A page with nothing wrong with it should look like a page, not like a page
// with an empty band at the top of it.
check('a page with nothing to say shows no notice band', () => {
  show(3)
  const bar = part('.notice-actions')
  equal(bar.getBoundingClientRect().height, 0, 'an empty action bar took up room')
  equal(part('.notices').childElementCount, 0, 'an empty notice list had children')
})

check('a notice with something to press shows the button', () => {
  let pressed = 0
  show(3, 0, ['No vault at /nowhere.'], [{ label: 'Choose a folder…', run: () => { pressed += 1 } }])
  const button = part('.notice-action')
  equal(button.textContent, 'Choose a folder…', 'the button was not labelled')
  button.click()
  equal(pressed, 1, 'pressing the button did nothing')
})

// The band is above everything else on the page, and the page still fits.
check('a notice does not push the footer off the bottom', () => {
  show(20, 0, ['No vault at /nowhere.'], [{ label: 'Choose a folder…', run: () => {} }])
  const foot = part('.page-foot')
  ok(
    foot.getBoundingClientRect().bottom <= stage.getBoundingClientRect().bottom + 1,
    'the notice band pushed the footer out of the window',
  )
})

// The whole point of the panel: it lies over the page, and the page is still
// there underneath when it goes away (spec §5.7).
check('the search covers the page and gives it back', () => {
  show(6)
  const panel = dayPage.search()
  equal(part('.search').getBoundingClientRect().height, 0, 'the search was up before it was opened')

  panel.open()
  const over = part('.search').getBoundingClientRect()
  const page = part('.page').getBoundingClientRect()
  equal(Math.round(over.height), Math.round(page.height), 'the search did not cover the page')
  equal(document.activeElement, part('.search-field'), 'the field was not ready to type in')

  panel.close()
  equal(part('.search').getBoundingClientRect().height, 0, 'the search stayed up')
})

check('typing a query lists the lines that match, grouped by day', () => {
  show(6)
  dayPage.search().open()
  const field = part('.search-field')
  ok(field instanceof HTMLInputElement, 'no field')
  field.value = 'Line number 3'
  field.dispatchEvent(new Event('input'))

  equal(stage.querySelectorAll('.search-group').length, 1, 'the results were not grouped by day')
  equal(stage.querySelectorAll('.search-hit').length, 1, 'the wrong number of lines matched')
  equal(part('.search-hit').textContent, 'Line number 3', 'the wrong line matched')
  equal(part('.search-summary').textContent, '1', 'the count was wrong')
})

check('a query that matches nothing says so', () => {
  show(6)
  dayPage.search().open()
  const field = part('.search-field')
  ok(field instanceof HTMLInputElement, 'no field')
  field.value = 'soldering iron'
  field.dispatchEvent(new Event('input'))

  equal(stage.querySelectorAll('.search-hit').length, 0, 'something matched')
  equal(part('.search-summary').textContent, 'nothing', 'the page did not say so')
})

// Otherwise the first press of Escape closes the whole popover, and what you
// were typing goes with it.
check('Escape closes the search rather than the page', () => {
  show(6)
  dayPage.search().open()
  const field = part('.search-field')
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  field.dispatchEvent(event)

  ok(event.defaultPrevented, 'the day would have taken the Escape as well')
  equal(dayPage.search().isOpen(), false, 'the search stayed up')
})

// A permission granted months ago in a text editor is one you will not
// remember granting; the whole point of the pane is that it is visible.
check('the settings pane lists a plugin and what it asks for', () => {
  show(3)
  dayPage.settings().render(SETTINGS_CONFIG, [{
    name: 'macos-calendar',
    enabled: true,
    slots: [],
    approvedSlots: [],
    asked: ['macos.calendar.read'],
    approved: ['macos.calendar.read'],
    open: [],
    approvedOpen: [],
    approvedMoves: [],
    run: [],
    approvedRun: new Map(),
    prefixes: [],
    heading: 'macos-calendar',
    actionLabel: 'macos-calendar',
    box: { width: 48, height: 48 },
    tab: 'macos-calendar',
    moves: [],
    notices: [],
    problem: null,
    schema: [],
    held: new Map(),
  }])
  dayPage.settings().open()

  const names = [...stage.querySelectorAll('.capability-name')].map((one) => one.textContent)
  equal(names.join(' '), 'macos.calendar.read', 'the capability was not listed')
  const boxes = [...stage.querySelectorAll('.plugin input')]
  equal(boxes.length, 2, 'a plugin needs a switch of its own and one per capability')
  ok(boxes.every((box) => box instanceof HTMLInputElement && box.checked), 'a granted capability showed as ungranted')
  dayPage.settings().close()
})

check('a setting written in the file shows in the pane', () => {
  show(3)
  dayPage.settings().render({ ...SETTINGS_CONFIG, theme: 'console', menuBarCount: false }, [])
  dayPage.settings().open()

  const fields = [...stage.querySelectorAll('.setting-field')]
  const theme = fields[1]
  ok(theme instanceof HTMLInputElement, 'no theme field')
  equal(theme.value, 'console', 'the theme field did not show what the config says')

  const count = stage.querySelector('.setting-box')
  ok(count instanceof HTMLInputElement, 'no switch')
  equal(count.checked, false, 'a switch that is off showed as on')
  dayPage.settings().close()
})

// Every change is written the moment it is made, the way an edit to a line
// is. There is no Save button to forget to press.
check('changing a setting reports it once, with the value', () => {
  show(3)
  /** @type {unknown[]} */
  const saved = []
  dayPage.mount(part('#app'), { ...handlersFor(), settings: {
    onChange: (patch) => { saved.push(patch) },
    onPlugin: () => {},
    onChooseVault: () => {},
  } })
  dayPage.settings().render(SETTINGS_CONFIG, [])
  dayPage.settings().open()

  const theme = [...stage.querySelectorAll('.setting-field')][1]
  ok(theme instanceof HTMLInputElement, 'no theme field')
  theme.value = 'console'
  theme.dispatchEvent(new Event('change'))
  equal(JSON.stringify(saved), JSON.stringify([{ theme: 'console' }]), 'the change did not reach the config')
})

// The config reader would refuse it anyway, with a notice nobody asked for.
check('a negative number of days is put back rather than written', () => {
  show(3)
  /** @type {unknown[]} */
  const saved = []
  dayPage.mount(part('#app'), { ...handlersFor(), settings: {
    onChange: (patch) => { saved.push(patch) },
    onPlugin: () => {},
    onChooseVault: () => {},
  } })
  dayPage.settings().render(SETTINGS_CONFIG, [])
  dayPage.settings().open()

  const lead = [...stage.querySelectorAll('.setting-field')][3]
  ok(lead instanceof HTMLInputElement, 'no lead-time field')
  lead.value = '-3'
  lead.dispatchEvent(new Event('change'))
  equal(saved.length, 0, 'a negative lead time was written')
  equal(lead.value, '7', 'the field was left showing something the config would refuse')
})

/**
 * Re-renders the page the plugins have now said something about. `show`
 * mounts it; this is the second render the two checks below both need, and
 * only the sections differ between them.
 *
 * @param {import('../../src/core/contributions.js').Section[]} sections
 * @param {import('../../src/core/sections.js').Block[]} [blocks]  what the
 *   plugins named for the day; a meeting's control is drawn from these
 * @param {Map<string, string[]>} [prefixes]  who owns which sidecar prefix
 * @returns {void}
 */
function contribute(sections, blocks, prefixes) {
  dayPage.render({
    today: '2026-09-01',
    page: '2026-09-01',
    view: DAY_VIEW,
    tabs: [],
    boards: [],
    doc: parse(pageOf(6)),
    horizon: [],
    carry: [],
    sections,
    blocks: blocks ?? [],
    prefixes: prefixes ?? new Map(),
    notices: [],
    actions: [],
  })
}

// Two contributors is the case the heading exists for - and since spec §1.1
// it is two cases, because a line with no time on it is not given a section
// at all. One of each here: the timed plugin keeps its heading under the
// list, and the untimed one's line folds under the day's own note as
// evidence, carrying the heading down with it.
check('a timed plugin is headed, an untimed one folds under the note, and the footer stays put', () => {
  show(6)
  contribute([
    { plugin: 'git-activity', heading: 'From git', events: [{ time: null, text: '6 commits to gotab-inc/node' }] },
    { plugin: 'macos-calendar', heading: 'On the calendar', events: [{ time: '09:30', text: 'Standup' }] },
  ])

  const heads = [...stage.querySelectorAll('.given-head')].map((one) => one.textContent)
  equal(heads.join(' | '), 'On the calendar', 'the untimed plugin was still given a section of its own')

  const folded = [...stage.querySelectorAll('.evidence-row')]
    .map((row) => [...row.children].map((cell) => cell.textContent).join(' · '))
  equal(folded.join(' | '), 'From git · 6 commits to gotab-inc/node', 'the untimed line did not fold under the note')

  const foot = part('.page-foot').getBoundingClientRect()
  const window = stage.getBoundingClientRect()
  ok(
    Math.abs(foot.bottom - window.bottom) <= 1,
    `two contributors pushed the footer to ${Math.round(foot.bottom)} in a window ending at ${Math.round(window.bottom)}`,
  )
})

// The heading is per plugin, so two plugins with something timed to say are
// two sections rather than one list under whichever heading came first.
check('two timed plugins get two headed sections', () => {
  show(6)
  contribute([
    { plugin: 'git-activity', heading: 'From git', events: [{ time: '17:40', text: '6 commits to gotab-inc/node' }] },
    { plugin: 'macos-calendar', heading: 'On the calendar', events: [{ time: '09:30', text: 'Standup' }] },
  ])

  const heads = [...stage.querySelectorAll('.given-head')].map((one) => one.textContent)
  equal(heads.join(' | '), 'From git | On the calendar', 'the two sections are not headed by their plugins')
  equal(stage.querySelectorAll('.evidence-row').length, 0, 'a timed line folded under the note')
})

/**
 * The note control on a meeting's row, in whichever of its three states
 * applies (spec §1.2).
 *
 * Here rather than in a node test because every one of these is a question
 * about what is *on screen*: `hidden`, computed opacity and a real press.
 * The three states had no browser cover at all until a day with two meetings
 * on it looked, correctly, like a day the feature had been removed from -
 * every check in this file rendered `blocks: []`, so the control had never
 * once been drawn under a layout engine.
 */
const MEETING = [{
  plugin: 'macos-calendar',
  heading: 'On the calendar',
  events: [{ time: '09:30', text: 'Standup' }],
}]
const OWNED = new Map([['macos-calendar', ['meeting']]])

/**
 * What the last press asked to open.
 *
 * Read through a call rather than off the variable: the handler that writes
 * it runs inside the view, so a checker following this file alone narrows
 * `opened` to the `null` it was last assigned here and refuses the read.
 *
 * @returns {import('../../src/core/sections.js').Block|null}
 */
function lastOpened() {
  return opened
}

/**
 * @param {string} selector
 * @returns {HTMLButtonElement}
 */
function offerIn(selector) {
  const one = stage.querySelector(selector)
  ok(one instanceof HTMLButtonElement, `no note control in ${selector}`)
  return /** @type {HTMLButtonElement} */ (one)
}

// Nothing this plugin owns answered for the row, so there is nothing a press
// could open. A button that does nothing is worse than no button.
check('a meeting no plugin offered a note on has no control', () => {
  show(6)
  contribute(MEETING, [], OWNED)
  ok(offerIn('.given-item .offer').hidden, 'a control was drawn with nothing behind it')
})

// The regression this file is being extended for: at rest the offer must be
// readable without being pointed at. It is the only way to start a meeting
// note, and `opacity: 0` made it unfindable.
check('an offered note is legible at rest and reaches full strength on focus', () => {
  show(6)
  contribute(MEETING, [{
    plugin: 'macos-calendar', suffix: 'meeting-standup', title: 'Standup', kind: 'offer',
  }], OWNED)

  const offer = offerIn('.given-item .offer')
  equal(offer.hidden, false, 'the offer was hidden')
  equal(offer.textContent, '＋ notes', 'the offer does not say what pressing it makes')

  const resting = Number(getComputedStyle(offer).opacity)
  ok(resting >= 0.3, `the offer rests at ${resting}, which is too faint to find`)
  ok(resting < 1, `the offer rests at ${resting}, which is as loud as the meeting itself`)
  ok(offer.getBoundingClientRect().width > 0, 'the offer takes up no room')

  // The keyboard half of the reveal rule. Hover cannot be driven from script;
  // `:focus-within` is the same declaration and is reachable by Tab.
  offer.focus()
  equal(getComputedStyle(offer).opacity, '1', 'focus did not bring the offer up to full')
})

// A note you already wrote is not something to hide behind a hover, and it
// says so by being the accent colour rather than the quiet one.
check('a note that exists is shown at full strength, and opens when pressed', () => {
  show(6)
  /** @type {import('../../src/core/sections.js').Block} */
  const block = {
    plugin: 'macos-calendar', suffix: 'meeting-standup', title: 'Standup', kind: 'editor',
  }
  contribute(MEETING, [block], OWNED)

  const offer = offerIn('.given-item .offer')
  equal(offer.textContent, '✎', 'a note that exists is not marked as one')
  ok(offer.classList.contains('done'), 'a note that exists is still drawn as an offer')
  equal(getComputedStyle(offer).opacity, '1', 'a note that exists was left faint')

  opened = null
  offer.click()
  equal(lastOpened()?.suffix, 'meeting-standup', 'the press did not ask for the meeting\'s own note')
})

// The day's margin (phase four §1.1). A picture beside the note has to stay
// inside the window, keep the footer where it was, and leave the note the rest
// of the row - none of which can be checked anywhere but in a browser.
const CREATURE = {
  plugin: 'pet',
  picture: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#17605B" /></svg>' },
  width: 48,
  height: 48,
}

check('a picture in the margin sits at the right-hand end of the note s row', () => {
  show(6, undefined, undefined, undefined, CREATURE)
  const row = part('.note-row')
  const note = part('.note')
  const box = part('.box')

  ok(box.getBoundingClientRect().width > 0, 'the margin drew nothing')
  ok(
    box.getBoundingClientRect().left >= note.getBoundingClientRect().right,
    'the picture is sitting on top of the note rather than beside it',
  )
  ok(
    box.getBoundingClientRect().right <= row.getBoundingClientRect().right + 0.5,
    'the picture is hanging off the end of the row',
  )
})

check('a long day with a picture still keeps the footer on the page', () => {
  show(60, undefined, undefined, undefined, CREATURE)
  const bottom = stage.getBoundingClientRect().bottom
  ok(part('.page-foot').getBoundingClientRect().bottom <= bottom, 'the footer was pushed off')
  ok(part('.box').getBoundingClientRect().bottom <= bottom, 'the picture was pushed off')
})

// A note long enough to scroll is the case where a box inside the note would
// have scrolled away with it. It is outside the note for exactly this reason.
check('the picture stays put while a long note scrolls past it', () => {
  show(6, undefined, undefined, undefined, CREATURE)
  const note = part('.note')
  note.textContent = 'How the day went. '.repeat(60)
  const before = part('.box').getBoundingClientRect().top
  note.scrollTop = note.scrollHeight
  ok(Math.abs(part('.box').getBoundingClientRect().top - before) < 0.5, 'the picture moved with the note')
})

// A day with no file yet hides the note, which leaves the picture as the only
// thing in the row. It is a margin, so it stays in the margin.
check('a picture on a day with no note yet stays in the margin', () => {
  show(0, undefined, undefined, undefined, CREATURE)
  const row = part('.note-row')
  const box = part('.box')
  part('.note').hidden = true

  ok(
    box.getBoundingClientRect().right >= row.getBoundingClientRect().right - 17,
    'the picture slid over to the left margin',
  )
})

check('no picture leaves the note exactly where it was', () => {
  show(6)
  ok(part('.box').getBoundingClientRect().width === 0, 'an empty margin is taking up room')
  ok(part('.note').getBoundingClientRect().width > 0, 'the note lost its row')
})


// ── a board in the popover ──────────────────────────────────
//
// The board is a view of this window now, not only of the detached one (spec
// §1). Everything below is either a measurement - the columns stack, the stack
// scrolls, the strip fits - or a gesture, which is the other half of what a
// browser is here for.

/** The move the last drop asked for.
 *  @type {{plugin: string, id: string, column: string, before: string|null}|null} */
let dropped = null

/** The card the last drop on the done column asked about. @type {string|null} */
let finished = null

/** The marker the last press on a chip asked to open.
 *  @type {{plugin: string, href: string}|null} */
let marked = null

/** @type {import('../../src/views/dayFooter.js').BoardTab[]} */
const KANBAN_TAB = [{ plugin: 'kanban', tab: 'Kanban' }]

/**
 * @param {number} [extra]  cards to pile into `To do`, for the scroll
 * @returns {import('../../src/plugins/pageAsking.js').Board[]}
 */
function kanban(extra = 0) {
  return [{
    plugin: 'kanban',
    tab: 'Kanban',
    board: '',
    answer: {
      columns: [
        {
          name: 'To do',
          cards: [
            { id: 'k4m2qa', index: null, text: 'Fix the gate', ended: null },
            { id: 'c1d2e3', index: null, text: 'Read the offline queue RFC', ended: null },
            ...Array.from({ length: extra }, (_, at) => ({
              id: `x${String(at).padStart(5, '0')}`,
              index: null,
              text: `Another thing to do, number ${at + 1}`,
              ended: /** @type {null} */ (null),
            })),
          ],
        },
        { name: 'Doing', cards: [{ id: 'p9x1bb', index: null, text: 'Call the vet', ended: null }] },
        { name: 'Done', cards: [] },
      ],
      archive: [],
    },
  }]
}

/**
 * The page on a given view, with a strip of board tabs behind it.
 *
 * @param {string} view
 * @param {import('../../src/views/dayFooter.js').BoardTab[]} [tabs]
 * @param {import('../../src/plugins/pageAsking.js').Board[]} [boards]
 * @param {number} [count]  lines on the day underneath
 * @param {Map<string, import('../../src/core/badges.js').Badge[]>} [cardBadges]
 * @returns {void}
 */
function showOn(view, tabs = [], boards = [], count = 6, cardBadges = new Map()) {
  went = null
  dropped = null
  finished = null
  marked = null

  stage.replaceChildren()
  const root = document.createElement('main')
  root.id = 'app'
  stage.append(root)

  dayPage.mount(root, {
    ...handlersFor(),
    onCard: (plugin, id, column, before) => { dropped = { plugin, id, column, before } },
    onFinish: (id) => { finished = id },
    onBadge: (plugin, href) => { marked = { plugin, href } },
  })
  drawOn(view, tabs, boards, count, cardBadges)
}

/**
 * Another draw of the page already mounted, for a test about what one draw
 * leaves the next one holding.
 *
 * @param {string} view
 * @param {import('../../src/views/dayFooter.js').BoardTab[]} [tabs]
 * @param {import('../../src/plugins/pageAsking.js').Board[]} [boards]
 * @param {number} [count]
 * @param {Map<string, import('../../src/core/badges.js').Badge[]>} [cardBadges]
 * @returns {void}
 */
function drawOn(view, tabs = [], boards = [], count = 6, cardBadges = new Map()) {
  dayPage.render({
    today: '2026-09-01',
    page: '2026-09-01',
    view,
    tabs,
    boards,
    cardBadges,
    doc: parse(pageOf(count)),
    horizon: [],
    carry: [],
    sections: [],
    blocks: [],
    prefixes: new Map(),
    box: null,
    notices: [],
    actions: [],
  })
}

/** The same board with nothing answered yet: the frame after its file changed,
 *  while the plugin is working out what it now says.
 *  @returns {import('../../src/plugins/pageAsking.js').Board[]} */
function waiting() {
  return [{ plugin: 'kanban', tab: 'Kanban', board: '', answer: null }]
}

/**
 * Robert's own board, which is the shape the drop was reported broken on: a
 * middle column holding nothing, between one that holds the work and the done
 * column that refuses drops. The empty middle is the only place there is to
 * drop a card, and it is the one arrangement the checks above never build.
 *
 * @returns {import('../../src/plugins/pageAsking.js').Board[]}
 */
function emptyMiddle() {
  return [{
    plugin: 'kanban',
    tab: 'Kanban',
    board: '',
    answer: {
      columns: [
        {
          name: 'To do',
          cards: [
            { id: 'gwt7lj', index: null, text: 'Tabs page optimizations', ended: null },
            { id: '98ff41', index: null, text: 'Gift card promotions', ended: null },
          ],
        },
        { name: 'Doing', cards: [] },
        {
          name: 'Done',
          cards: [{ id: '101jw5', index: null, text: 'Fix saving clutch gift card', ended: 'done' }],
        },
      ],
      archive: [],
    },
  }]
}

/** The words on every tab the strip is actually showing, in order.
 *  @returns {string[]} */
function tabWords() {
  return [...stage.querySelectorAll('.tabs .tab')]
    .filter((tab) => tab instanceof HTMLElement && !tab.hidden && !tab.classList.contains('more-tab'))
    .map((tab) => tab.textContent ?? '')
}

check('a board plugin gets a tab in the day footer', () => {
  // The thing Robert asked for: the popover's own footer, not only the
  // detached window's strip.
  showOn(DAY_VIEW, KANBAN_TAB)
  ok(tabWords().includes('Kanban'), `the strip reads ${tabWords().join(' ')}`)
})

check('and at the width the popover opens at, nothing is behind the …', () => {
  showOn(DAY_VIEW, KANBAN_TAB)
  equal(tabWords().join(' '), 'Day Week Month Someday Kanban', 'the default strip was cut down')
  equal(part('.more').hidden, true, 'the … appeared with nothing behind it')
})

check('a day with no board plugin has no board tab', () => {
  showOn(DAY_VIEW)
  equal(tabWords().join(' '), 'Day Week Month Someday', 'a tab appeared for nobody')
})

check('pressing a board s tab asks for that board', () => {
  showOn(DAY_VIEW, KANBAN_TAB)
  const tab = [...stage.querySelectorAll('.tabs .tab')]
    .find((one) => one.textContent === 'Kanban')
  ok(tab instanceof HTMLElement, 'no Kanban tab to press')
  tab.click()
  equal(went, 'board:kanban', 'the tab asked for the wrong view')
})

check('the board covers the day, and the day comes back', () => {
  showOn('board:kanban', KANBAN_TAB, kanban())
  equal(part('.day-body').hidden, true, 'the day was left under the board')
  equal(part('.board').hidden, false, 'the board was not drawn')
  equal(part('.view-title').textContent, 'Kanban', 'the board did not name itself')

  showOn(DAY_VIEW, KANBAN_TAB, kanban())
  equal(part('.day-body').hidden, false, 'the day did not come back')
  equal(part('.board').hidden, true, 'the board stayed up')
})

// A plugin switched off between one draw and the next. The strip is asking for
// a board that is no longer there, and a blank window would be the worst of
// the answers available.
check('a board nobody keeps any more falls back to the day', () => {
  showOn('board:ghost')
  equal(part('.day-body').hidden, false, 'the day was hidden for a board that is gone')
  equal(part('.board').hidden, true, 'an empty board was drawn')
})

check('while a board is up, the page keeps only its own way back', () => {
  // Nothing on the header navigates a board - there is no previous day of a
  // board - but the pin stays, because the popover still has to be pinnable.
  showOn('board:kanban', KANBAN_TAB, kanban())
  const head = part('.page-head')
  ok(head.classList.contains('on-board'), 'the header was not told')
  const shown = [...head.querySelectorAll('.page-nav > button')]
    .filter((one) => one instanceof HTMLElement && one.getBoundingClientRect().width > 0)
  equal(shown.length, 1, 'the wrong number of header buttons survived')
  ok(shown[0]?.classList.contains('pin') === true, 'the one left is not the pin')
})

check('the popover s board stacks its columns down the page', () => {
  // Robert's decision: vertical, because 380 points is one column wide.
  showOn('board:kanban', KANBAN_TAB, kanban())
  const columns = [...stage.querySelectorAll('.board-column')]
    .filter((one) => one instanceof HTMLElement)
  equal(columns.length, 3, 'the wrong number of columns')

  for (let at = 1; at < columns.length; at += 1) {
    const above = columns[at - 1]?.getBoundingClientRect()
    const below = columns[at]?.getBoundingClientRect()
    ok(above !== undefined && below !== undefined, 'a column has no box')
    ok(below.top >= above.bottom - 1, `column ${at} sits beside column ${at - 1}, not under it`)
    ok(Math.abs(below.left - above.left) < 1, `column ${at} is indented from the one above`)
  }
})

check('and a long board is one scroller, with the footer still on the page', () => {
  showOn('board:kanban', KANBAN_TAB, kanban(30))
  const columns = part('.board-columns')
  ok(columns.scrollHeight > columns.clientHeight, 'a thirty-card board did not become scrollable')

  const bottom = stage.getBoundingClientRect().bottom + 1
  ok(part('.page-foot').getBoundingClientRect().bottom <= bottom, 'the board pushed the footer off')
  equal(Math.round(part('.page').getBoundingClientRect().height), 560, 'the page grew past the window')

  // One scroller, not one per column: a drag that had to scroll the column it
  // started in to get out of it would be two gestures.
  const cards = part('.board-cards')
  ok(cards.scrollHeight <= cards.clientHeight + 1, 'a column scrolled its own cards')

  // And the last column can be reached by scrolling the stack.
  columns.scrollTop = columns.scrollHeight
  const last = [...columns.querySelectorAll('.board-column')].pop()
  ok(last instanceof HTMLElement, 'no last column')
  ok(
    last.getBoundingClientRect().bottom <= columns.getBoundingClientRect().bottom + 1,
    'the done column cannot be scrolled to',
  )
})

check('at the minimum width the strip is Day Week Month and a …', () => {
  // Robert's first case, measured rather than estimated. The stage is set to
  // the popover's minimum before the page is built, so the first fit is the
  // one under test.
  stage.style.width = '300px'
  try {
    showOn(DAY_VIEW, KANBAN_TAB)
    equal(tabWords().join(' '), 'Day Week Month', `the strip reads ${tabWords().join(' ')}`)
    equal(part('.more').hidden, false, 'nothing offered a way to the demoted tabs')
  } finally {
    stage.style.width = ''
  }
})

check('and the … menu s rows do what their tabs do', () => {
  stage.style.width = '300px'
  try {
    showOn(DAY_VIEW, KANBAN_TAB)
    const button = part('.more-tab')
    equal(part('.more-list').hidden, true, 'the menu was open before it was opened')
    button.click()
    equal(part('.more-list').hidden, false, 'the menu did not open')

    const rows = [...stage.querySelectorAll('.more-row')]
      .filter((one) => one instanceof HTMLElement)
    equal(rows.map((one) => one.textContent ?? '').join(' '), 'Someday Kanban', 'the wrong rows')

    const kanbanRow = rows.find((one) => one.textContent === 'Kanban')
    ok(kanbanRow instanceof HTMLElement, 'no Kanban row')
    kanbanRow.click()
    equal(went, 'board:kanban', 'the row asked for the wrong view')
    equal(part('.more-list').hidden, true, 'the menu stayed open after choosing')
  } finally {
    stage.style.width = ''
  }
})

check('and Escape closes the menu rather than the page', () => {
  stage.style.width = '300px'
  try {
    showOn(DAY_VIEW, KANBAN_TAB)
    part('.more-tab').click()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    part('.more-list').dispatchEvent(event)
    ok(event.defaultPrevented, 'the day would have taken the Escape as well')
    equal(part('.more-list').hidden, true, 'the menu stayed up')
  } finally {
    stage.style.width = ''
  }
})

/**
 * A card dragged onto something, as the browser delivers it: one `DataTransfer`
 * carried through all three events, which is what makes the drop able to read
 * what the dragstart wrote.
 *
 * @param {HTMLElement} card
 * @param {HTMLElement} onto
 * @returns {void}
 */
function drag(card, onto) {
  const data = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
  onto.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }))
  onto.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
}

/**
 * @param {string} selector
 * @returns {HTMLElement}
 */
function boardPart(selector) {
  const found = part('.board').querySelector(selector)
  if (!(found instanceof HTMLElement)) throw new Error(`no ${selector} on the board`)
  return found
}

/** The same, for a test about something being *gone*: null rather than a throw.
 *  @param {string} selector
 *  @returns {HTMLElement|null} */
function onBoard(selector) {
  const found = part('.board').querySelector(selector)
  return found instanceof HTMLElement ? found : null
}

check('a card dragged into another stacked column writes the move', () => {
  showOn('board:kanban', KANBAN_TAB, kanban())
  drag(boardPart('[data-card="k4m2qa"]'), boardPart('[data-column="Doing"]'))
  const move = dropped
  ok(move !== null, 'the drop went nowhere')
  equal(move.plugin, 'kanban', 'the wrong board')
  equal(move.id, 'k4m2qa', 'the wrong card')
  equal(move.column, 'Doing', 'the wrong column')
  equal(move.before, null, 'a drop on the column itself landed in front of something')
})

check('and dropped onto a card, it lands in front of it', () => {
  showOn('board:kanban', KANBAN_TAB, kanban())
  drag(boardPart('[data-card="p9x1bb"]'), boardPart('[data-card="c1d2e3"]'))
  const move = dropped
  ok(move !== null, 'the drop went nowhere')
  equal(move.id, 'p9x1bb', 'the wrong card moved')
  equal(move.column, 'To do', 'the wrong column took it')
  equal(move.before, 'c1d2e3', 'the card did not land in front of the one under it')
})

check('a column holding nothing is still somewhere to drop', () => {
  // The shape a board reaches once the middle column is cleared, and the one
  // the checks above never build: every drop they make lands on a column that
  // already has cards in it. An empty one has no `.board-cards` to speak of,
  // so the column itself is the whole of the target.
  showOn('board:kanban', KANBAN_TAB, emptyMiddle())
  const empty = boardPart('[data-column="Doing"]')
  equal(empty.querySelectorAll('.board-card').length, 0, 'the middle column was not empty')
  drag(boardPart('[data-card="gwt7lj"]'), empty)
  const move = dropped
  ok(move !== null, 'a drop on an empty column went nowhere')
  equal(move.id, 'gwt7lj', 'the wrong card moved')
  equal(move.column, 'Doing', 'the empty column did not take the card')
  equal(move.before, null, 'an empty column put the card in front of something')
})

check('and dropped on the name of an empty column, which is what is on screen', () => {
  // The heading is sticky and, in a column with no cards, most of what there
  // is to aim at - so it is the element the pointer is actually over.
  showOn('board:kanban', KANBAN_TAB, emptyMiddle())
  const name = boardPart('[data-column="Doing"] .board-column-name')
  drag(boardPart('[data-card="gwt7lj"]'), name)
  const move = dropped
  ok(move !== null, 'a drop on the column name went nowhere')
  equal(move.column, 'Doing', 'the wrong column took it')
})

/** The markers `cardBadgesFor` would have found for one card of `kanban()`.
 *  @param {string} card  the card's id
 *  @returns {Map<string, import('../../src/core/badges.js').Badge[]>} */
function noteOn(card) {
  return new Map([[
    cardMarkKey('kanban', { id: card, index: null, text: '', ended: null }),
    [{ plugin: 'task-notes', label: 'note', href: 'sidecar:2026-09-01/note' }],
  ]])
}

check('a card with a note draws a chip, and one without draws nothing', () => {
  showOn('board:kanban', KANBAN_TAB, kanban(), 6, noteOn('k4m2qa'))
  const marks = boardPart('[data-card="k4m2qa"]').querySelectorAll('.item-badge')
  equal(marks.length, 1, 'the card with a note has no chip')
  equal(marks[0]?.textContent, 'note', 'the chip says the wrong thing')
  equal(
    onBoard('[data-card="c1d2e3"] .item-badge'),
    null,
    'a card with no note drew a chip anyway',
  )
})

check('pressing the chip asks to open that ref', () => {
  showOn('board:kanban', KANBAN_TAB, kanban(), 6, noteOn('k4m2qa'))
  boardPart('[data-card="k4m2qa"] .item-badge').click()
  const opened = marked
  ok(opened !== null, 'the press went nowhere')
  equal(opened.plugin, 'task-notes', 'the wrong plugin was asked')
  equal(opened.href, 'sidecar:2026-09-01/note', 'the wrong ref')
})

check('and pressing it does not start a drag', () => {
  // The hazard the chip sits in the middle of: a card is draggable, so a press
  // inside one lifts it unless the press is spoken for.
  showOn('board:kanban', KANBAN_TAB, kanban(), 6, noteOn('k4m2qa'))
  const card = boardPart('[data-card="k4m2qa"]')
  const chip = boardPart('[data-card="k4m2qa"] .item-badge')
  equal(chip.draggable, false, 'the chip is its own drag source')

  chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  const data = new DataTransfer()
  const start = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data })
  card.dispatchEvent(start)
  ok(start.defaultPrevented, 'a press on the chip lifted the card')
  equal(data.types.includes('application/x-planner-card'), false, 'the card was picked up anyway')
})

check('a card still drags from anywhere else on it, chip or no chip', () => {
  showOn('board:kanban', KANBAN_TAB, kanban(), 6, noteOn('k4m2qa'))
  const card = boardPart('[data-card="k4m2qa"]')
  // The press lands on the words, which is the rest of the card.
  boardPart('[data-card="k4m2qa"] .board-card-text')
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  drag(card, boardPart('[data-column="Doing"]'))
  const move = dropped
  ok(move !== null, 'a card with a chip could not be moved')
  equal(move.id, 'k4m2qa', 'the wrong card moved')
  equal(move.column, 'Doing', 'the wrong column took it')
})

check('a card dropped on the last column is a question, not a move', () => {
  // Design §6: a card reaches Done by the line being ticked, which is a write
  // into the day file and the one thing a board does not do.
  showOn('board:kanban', KANBAN_TAB, kanban())
  drag(boardPart('[data-card="k4m2qa"]'), boardPart('[data-column="Done"]'))
  equal(dropped, null, 'the done column took a move')
  equal(finished, 'k4m2qa', 'the refusal said nothing useful')
})

check('a board waiting on a new answer keeps the cards it is showing', () => {
  // The frame after a drop. Moving a card rewrites `board.md`, the file is
  // the board's cache key, so the next draw is a miss and the answer is null
  // until the plugin has read the file it has just been handed. Drawn as the
  // empty board, that is the whole board blinking out on every drop.
  showOn('board:kanban', KANBAN_TAB, kanban())
  drawOn('board:kanban', KANBAN_TAB, waiting())
  equal(boardPart('[data-column="To do"]').querySelectorAll('.board-card').length, 2, 'the columns emptied')
  ok(onBoard('[data-card="p9x1bb"]') !== null, 'a card vanished while the plugin was thinking')
})

check('and a board that has never answered is still the empty board', () => {
  // The other half: nothing to keep, so the tab is an empty board rather than
  // a blank window, and says why.
  showOn('board:kanban', KANBAN_TAB, waiting())
  equal(onBoard('.board-column'), null, 'columns appeared for an answer nobody gave')
  equal(part('.board .count').textContent, 'waiting', 'the count did not say why the board is empty')
})

check('and one board s cards are never left under another board s name', () => {
  // Keeping what is on screen is only right while it is the same board's. A
  // tab pressed for a board that has not answered yet must not leave the
  // board beside it drawn under the new one's title.
  showOn('board:kanban', KANBAN_TAB, kanban())
  drawOn('board:other', [{ plugin: 'other', tab: 'Other' }], [
    { plugin: 'other', tab: 'Other', board: '', answer: null },
  ])
  equal(onBoard('.board-column'), null, 'the kanban board was left under the other board s name')
})

report()
