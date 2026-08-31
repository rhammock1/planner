// @ts-check

/**
 * Draws the menu bar icon and writes it as a PNG.
 *
 * The icon is generated rather than committed as a binary because it is nine
 * lines of geometry - a ruled box with a tick in it - and a drawing you can
 * read is easier to adjust than one you have to open an editor for.
 *
 * macOS wants a template image: black where there is ink, transparent
 * everywhere else, and the system recolours it for light, dark and the
 * highlighted menu bar. Nothing here sets a colour for that reason.
 *
 * Usage: `node tools/make-icon.js`
 */

import { writeFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'

const SIZE = 44
const INSET = 7
const STROKE = 3

/** @type {Uint8Array} alpha per pixel; the image is black throughout */
const alpha = new Uint8Array(SIZE * SIZE)

/**
 * @param {number} x
 * @param {number} y
 * @param {number} value 0-255
 * @returns {void}
 */
function ink(x, y, value = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const at = y * SIZE + x
  if ((alpha[at] ?? 0) < value) alpha[at] = value
}

/**
 * A line, thickened by stamping a square at each step. Good enough at this
 * size, and it keeps the corners of the tick square rather than mitred.
 *
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} width
 * @returns {void}
 */
function stroke(x1, y1, x2, y2, width) {
  const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 4)
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    const x = Math.round(x1 + (x2 - x1) * t)
    const y = Math.round(y1 + (y2 - y1) * t)
    for (let dy = 0; dy < width; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        ink(x + dx - (width >> 1), y + dy - (width >> 1))
      }
    }
  }
}

const near = INSET
const far = SIZE - INSET

// The box: a page, squared off.
stroke(near, near, far, near, STROKE)
stroke(near, far, far, far, STROKE)
stroke(near, near, near, far, STROKE)
stroke(far, near, far, far, STROKE)

// The tick, sitting slightly proud of centre the way a hand-drawn one does.
stroke(near + 5, SIZE / 2, SIZE / 2 - 1, far - 8, STROKE + 1)
stroke(SIZE / 2 - 1, far - 8, far - 4, near + 6, STROKE + 1)

/** @type {number[]} */
const raw = []
for (let y = 0; y < SIZE; y += 1) {
  raw.push(0) // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    raw.push(0, 0, 0, alpha[y * SIZE + x] ?? 0)
  }
}

/**
 * @param {string} type
 * @param {Buffer} body
 * @returns {Buffer}
 */
function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const check = Buffer.alloc(4)
  check.writeUInt32BE(crc32(tagged))
  return Buffer.concat([length, tagged, check])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 6 // colour type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.from(raw), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = new URL('../src-tauri/icons/icon.png', import.meta.url)
writeFileSync(out, png)
process.stdout.write(`wrote ${SIZE}x${SIZE} template icon to ${out.pathname}\n`)
