// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readBox, boxSize, boxQuestion, paints, PAINTS, SIDE } from '../src/core/box.js'
import { readManifest } from '../src/core/manifest.js'
import { isSlot, sentenceFor, optionsTableOf } from '../src/core/slots.js'

const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle r="8" /></svg>'
const ORDINARY = new Map([['pet', { width: SIDE, height: SIDE }]])

/**
 * @param {{plugin: string, value: unknown}[]} answers
 * @param {Map<string, {width: number, height: number}>} [sizes]
 */
function read(answers, sizes = ORDINARY) {
  return readBox(answers, sizes)
}

describe('the picture the margin draws', () => {
  test('one plugin with a drawing gets the margin', () => {
    const { box, notices } = read([{ plugin: 'pet', value: { svg: DRAWING } }])
    assert.equal(box?.plugin, 'pet')
    assert.equal(box?.picture.svg, DRAWING)
    assert.deepEqual(notices, [])
  })

  test('the size comes from the manifest, not from the answer', () => {
    const { box } = read([{ plugin: 'pet', value: { svg: DRAWING } }], new Map([['pet', { width: 32, height: 24 }]]))
    assert.equal(box?.width, 32)
    assert.equal(box?.height, 24)
  })

  // A plugin with nothing to draw this time is answering, not malformed.
  test('nothing to say leaves the margin empty and says nothing about it', () => {
    for (const value of [null, undefined]) {
      const { box, notices } = read([{ plugin: 'pet', value }])
      assert.equal(box, null)
      assert.deepEqual(notices, [])
    }
  })

  test('no plugins at all is simply no box', () => {
    assert.deepEqual(read([]), { box: null, notices: [] })
  })
})

describe('when the margin cannot be drawn', () => {
  test('an answer that is not a picture is named', () => {
    const { box, notices } = read([{ plugin: 'pet', value: 'a mouse' }])
    assert.equal(box, null)
    assert.match(notices[0] ?? '', /pet answered the margin with something that is not a picture/)
  })

  test('a list is not a picture either', () => {
    assert.match(read([{ plugin: 'pet', value: [DRAWING] }]).notices[0] ?? '', /not a picture/)
  })

  test('a refused drawing is reported under the plugin that sent it', () => {
    const { box, notices } = read([{ plugin: 'pet', value: { svg: '<svg><script>x()</script></svg>' } }])
    assert.equal(box, null)
    assert.match(notices[0] ?? '', /^pet sent a picture with a <script> in it$/)
  })

  // There is one margin. Picking the first would make which creature you get
  // depend on the order plugins happen to be listed in.
  test('two plugins claiming the margin means neither is drawn', () => {
    const { box, notices } = read(
      [{ plugin: 'pet', value: { svg: DRAWING } }, { plugin: 'ghost', value: { svg: DRAWING } }],
      new Map([['pet', { width: SIDE, height: SIDE }], ['ghost', { width: SIDE, height: SIDE }]]),
    )
    assert.equal(box, null)
    assert.match(notices.at(-1) ?? '', /pet and ghost both want the day's margin, so neither is drawn/)
  })

  test('but one good drawing beside one broken one still draws', () => {
    const { box, notices } = read(
      [{ plugin: 'ghost', value: { svg: '<html></html>' } }, { plugin: 'pet', value: { svg: DRAWING } }],
      new Map([['pet', { width: SIDE, height: SIDE }], ['ghost', { width: SIDE, height: SIDE }]]),
    )
    assert.equal(box?.plugin, 'pet')
    assert.equal(notices.length, 1)
  })
})

describe('how big a box asks to be', () => {
  /** @param {string} table */
  function sized(table) {
    const manifest = readManifest(`entry = "pet.js"\nslots = ["page.box"]\n${table}`)
    assert.equal(manifest.error, null)
    return boxSize(manifest)
  }

  test('a manifest that says nothing gets the measured default', () => {
    assert.deepEqual(sized(''), { width: SIDE, height: SIDE })
  })

  test('a manifest that asks for a size gets it', () => {
    assert.deepEqual(sized('[box]\nwidth = 32\nheight = 40\n'), { width: 32, height: 40 })
  })

  // The number is a request about the app's own page, so the app has the last
  // word on it rather than refusing the plugin outright.
  test('a size beyond what the page can pay is pulled into range', () => {
    assert.deepEqual(sized('[box]\nwidth = 4000\nheight = 1\n'), { width: 64, height: 16 })
  })

  test('nonsense reads as the ordinary size', () => {
    assert.deepEqual(sized('[box]\nwidth = "wide"\n'), { width: SIDE, height: SIDE })
  })
})

describe('what the plugin is told', () => {
  const GLANCE = { open: 3, done: 5, due: 0, overdue: 1 }
  const THEME = { paper: '#fff', ink: '#111', dim: '#777', accent: '#07c', alert: '#c00' }

  test('the day, four counts and the paper it is drawn on, and nothing else', () => {
    const question = boxQuestion('2026-09-14', GLANCE, THEME)

    assert.deepEqual(Object.keys(question).sort(), ['date', 'glance', 'theme'])
    assert.equal(question.date, '2026-09-14')
    assert.deepEqual(question.glance, GLANCE)
    assert.deepEqual(question.theme, THEME)
  })

  // The host writes these over every question from the slot's name and its own
  // clock, so a question that carried them would be handing a plugin two
  // fields it is about to have overwritten.
  test('it does not carry the two things the host owns', () => {
    const question = boxQuestion('2026-09-14', GLANCE, THEME)
    assert.equal('kind' in question, false)
    assert.equal('now' in question, false)
  })

  test('the paints are the five a drawing can use, and no font or texture', () => {
    const wearing = new Map([
      ['paper', '#FBFAF6'], ['ink', '#23262A'], ['dim', '#8B8981'],
      ['accent', '#17605B'], ['alert', '#A8452C'],
      ['font-head', 'Newsreader, serif'], ['texture', 'radial-gradient(#E2DFD4 1px, transparent 1px)'],
    ])
    assert.deepEqual(paints(wearing), {
      paper: '#FBFAF6', ink: '#23262A', dim: '#8B8981', accent: '#17605B', alert: '#A8452C',
    })
    assert.deepEqual([...PAINTS], ['paper', 'ink', 'dim', 'accent', 'alert'])
  })

  test('a colour the theme does not hold is simply not there', () => {
    assert.deepEqual(paints(new Map([['ink', '#000']])), { ink: '#000' })
  })
})

describe('the tick beside the slot', () => {
  test('page.box is a slot this version offers', () => {
    assert.equal(isSlot('page.box'), true)
    assert.equal(optionsTableOf('page.box'), 'box')
  })

  // The sentence is the consent. It has to say what the plugin is shown, and
  // this one is shown counts rather than words.
  test('its sentence says it is told counts and not words', () => {
    const sentence = sentenceFor('page.box')
    assert.match(sentence, /margin/)
    assert.match(sentence, /no line's words/)
  })
})
