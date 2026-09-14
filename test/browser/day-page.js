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

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

/** The block the last press of a meeting's note control asked to open.
 *  @type {import('../../src/core/sections.js').Block|null} */
let opened = null

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
    onOpenSpread: () => {},
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
    onOpenSpread: () => {},
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
  const order = [...stage.querySelectorAll('.page > *')].map((part) => part.className)
  equal(order.join(' '), 'page-head notice-band carry horizon items add day-sections note-row evidence page-foot search settings note-view', 'the section is in the wrong place')
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

report()
