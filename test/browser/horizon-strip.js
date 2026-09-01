// @ts-check

/**
 * The horizon strip decides whether to scroll by measuring itself, which
 * needs a browser: `scrollWidth` is zero everywhere else.
 *
 * The check that matters is the second one. The fade at the strip's edges is
 * there so text sliding past dissolves instead of being chopped; applied to a
 * strip that is not sliding, it dissolved the first entry's lead time into the
 * background - "1d" faded to nothing, and the item's first letters with it.
 */

import { check, ok, report } from './harness.js'
import { createHorizonStrip } from '../../src/views/horizonStrip.js'

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

/**
 * @param {string} text
 * @param {number} daysRemaining
 * @returns {import('../../src/core/horizon.js').HorizonEntry}
 */
function entry(text, daysRemaining) {
  return {
    page: '2026-09-02',
    index: 0,
    item: /** @type {any} */ ({ kind: 'item', state: 'open', text, note: null }),
    due: '2026-09-02',
    daysRemaining,
    overdue: daysRemaining < 0,
  }
}

/**
 * @param {import('../../src/core/horizon.js').HorizonEntry[]} entries
 * @returns {{strip: HTMLElement, mask: HTMLElement, track: HTMLElement}}
 */
function mount(entries) {
  stage.replaceChildren()
  const strip = createHorizonStrip()
  stage.append(strip.element)
  strip.render(entries)
  const mask = strip.element.querySelector('.horizon-mask')
  const track = strip.element.querySelector('.horizon-track')
  if (!(mask instanceof HTMLElement) || !(track instanceof HTMLElement)) throw new Error('no strip')
  return { strip: strip.element, mask, track }
}

check('a strip that fits does not scroll', () => {
  const { track } = mount([entry('Firmware sign-off', 1)])
  ok(!track.classList.contains('marquee'), 'a strip with room to spare was set scrolling')
})

check('a strip that fits is not faded', () => {
  const { mask } = mount([entry('Firmware sign-off', 1)])
  ok(!mask.classList.contains('faded'), 'faded')
  ok(getComputedStyle(mask).maskImage === 'none', `mask-image was ${getComputedStyle(mask).maskImage}`)
})

// The first thing in the strip is the lead badge, and it starts at the very
// pixel the gradient is transparent at. Fading a strip that is standing still
// hides it completely.
check('the first entry is fully painted when the strip fits', () => {
  const { mask } = mount([entry('Firmware sign-off', 1)])
  const badge = mask.querySelector('.hz b')
  if (!(badge instanceof HTMLElement)) throw new Error('no lead badge')
  ok(badge.textContent === '1d', `badge read ${String(badge.textContent)}`)
  ok(
    Math.abs(badge.getBoundingClientRect().left - mask.getBoundingClientRect().left) < 1,
    'the badge is not at the mask edge; this check no longer proves anything',
  )
  ok(getComputedStyle(mask).maskImage === 'none', 'the badge sits under a fade')
})

check('a strip too wide to fit scrolls and is faded', () => {
  const long = [
    entry('Firmware sign-off - start the checklist and chase the vendor', 1),
    entry('Payout reconciliation with the finance team', 5),
    entry('Quarterly hardware audit for the back-of-house units', 9),
  ]
  const { mask, track } = mount(long)
  ok(track.classList.contains('marquee'), 'an overflowing strip stood still')
  ok(mask.classList.contains('faded'), 'an overflowing strip was not faded')
  ok(getComputedStyle(mask).maskImage !== 'none', 'no fade on a scrolling strip')
})

check('an empty horizon is hidden entirely', () => {
  const { strip } = mount([])
  ok(strip.hidden, 'an empty strip was left on the page')
})

report()
