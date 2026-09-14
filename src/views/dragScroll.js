// @ts-check

/**
 * Scrolling a container while something is being dragged over it.
 *
 * The browser does not do this. A drag holds the pointer captive - there are
 * no wheel events and no scroll gestures while a card is in the air - so a
 * container taller than its window is a container whose bottom half cannot be
 * reached by dragging. Stacked, a board is exactly that: three columns down
 * the page in a window 560 points tall, and the column you want is usually the
 * one off the bottom.
 *
 * Split in two on purpose. `scrollStep` is the whole of the decision and is
 * arithmetic over four numbers, so it is checked under `node --test` with no
 * browser at all; `autoScroll` is the wiring, which is a frame loop and three
 * listeners and has nothing left in it to get wrong.
 */

/**
 * How near an edge the pointer has to be, in px, before the container moves.
 *
 * 44 rather than something finer: this is a band you have to be able to hold a
 * dragged card inside while reading what is scrolling past, and a band of ten
 * points is one the hand slips out of.
 */
export const EDGE = 44

/**
 * The most the container moves in one frame, in px. At sixty frames a second
 * that is a screenful of a 560-point window in about two-thirds of a second -
 * fast enough to cross a long board without waiting, slow enough to stop on
 * the column you meant.
 */
export const FASTEST = 14

/**
 * How far to scroll this frame: negative up, positive down, zero to stay.
 *
 * The band is a third of the container at most, so a short container still has
 * a neutral middle. Without that clamp a container 80px tall would be two
 * 44px bands overlapping, and there would be nowhere to hold the pointer still
 * - every position would scroll, including the one you were aiming at.
 *
 * A pointer past either edge is treated as being at that edge rather than as
 * being nowhere. `dragover` only fires over the element, so this is a rounding
 * case rather than a real position, and answering it with the fastest step is
 * both the intuitive reading and one less dead spot than answering with zero.
 *
 * @param {number} top  the container's top edge, in client coordinates
 * @param {number} bottom  its bottom edge
 * @param {number} y  the pointer, in the same coordinates
 * @returns {number}
 */
export function scrollStep(top, bottom, y) {
  const height = bottom - top
  if (height <= 0) return 0

  const band = Math.min(EDGE, height / 3)
  if (band <= 0) return 0

  const at = Math.min(Math.max(y, top), bottom)
  const into = { up: top + band - at, down: at - (bottom - band) }
  if (into.up > 0) return -ramp(into.up, band)
  if (into.down > 0) return ramp(into.down, band)
  return 0
}

/**
 * The speed at a given depth into a band: none at its inner limit, `FASTEST`
 * at the edge, and never rounded down to standing still once inside it.
 *
 * @param {number} into  px past the band's inner limit
 * @param {number} band
 * @returns {number}
 */
function ramp(into, band) {
  return Math.max(1, Math.round(FASTEST * Math.min(into / band, 1)))
}

/**
 * Makes an element scroll itself while a drag it cares about is over it.
 *
 * Whatever the element scrolls, which is the point of asking it rather than
 * asking the board: in the popover the stack of columns scrolls downwards, and
 * in the spread window the same element scrolls sideways and has no vertical
 * overflow to move - so there this is attached, costs a listener, and does
 * nothing.
 *
 * @param {HTMLElement} element
 * @param {(data: DataTransfer|null) => boolean} carries  whether a drag is one
 *   this container should move for. A file dragged in from the desktop is not.
 * @returns {void}
 */
export function autoScroll(element, carries) {
  /** Where the pointer was at the last `dragover`. */
  let y = 0
  /** @type {number|null} */
  let frame = null

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }

  function step() {
    // Read every frame rather than once at the start: the window can be
    // resized mid-drag, and a board redrawn under the pointer moves its own
    // edges.
    const box = element.getBoundingClientRect()
    const by = scrollStep(box.top, box.bottom, y)
    if (by !== 0) element.scrollTop += by
    frame = requestAnimationFrame(step)
  }

  element.addEventListener('dragover', (event) => {
    if (!carries(event.dataTransfer)) return
    y = event.clientY
    if (frame === null) frame = requestAnimationFrame(step)
  })

  // Both ends of the gesture, and the way out of it. `dragend` fires on the
  // card, which is inside this element, so it arrives here by bubbling.
  element.addEventListener('drop', stop)
  element.addEventListener('dragend', stop)
  element.addEventListener('dragleave', (event) => {
    // Only when the pointer has left the container. Crossing from one card to
    // the next fires this too, and stopping there would make the scroll
    // stutter through exactly the region it is meant to move.
    if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return
    stop()
  })
}
