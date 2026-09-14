// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readPicture, LONGEST } from '../src/core/picture.js'

/**
 * @param {string} body
 * @returns {string}
 */
function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`
}

/**
 * @param {unknown} answer
 * @returns {string}
 */
function refusal(answer) {
  const read = readPicture(answer)
  assert.ok('refused' in read, `expected a refusal, got ${JSON.stringify(read)}`)
  return read.refused
}

/**
 * @param {unknown} answer
 * @returns {string}
 */
function drawn(answer) {
  const read = readPicture(answer)
  assert.ok('picture' in read, `expected a picture, got ${JSON.stringify(read)}`)
  return read.picture.svg
}

describe('a picture this app will draw', () => {
  test('a well-formed drawing passes, byte for byte', () => {
    const one = svg('<circle cx="24" cy="24" r="20" fill="#1c1a17" />')
    assert.equal(drawn(one), one)
  })

  test('self-closing and paired tags both nest', () => {
    drawn(svg('<g fill="none"><path d="M8 8 L40 40" /><circle cx="24" cy="24" r="4" /></g>'))
  })

  test('a comment is skipped rather than refused', () => {
    drawn(svg('<!-- the eye --><circle cx="18" cy="20" r="3" />'))
  })

  test('a link within the picture is allowed', () => {
    drawn(svg('<a href="#face"><circle cx="24" cy="24" r="8" /></a>'))
  })

  // These came off the refused list deliberately: they are ordinary drawing
  // elements, and reaching outside the picture is what the href rule refuses.
  test('use and image are drawing, not doors', () => {
    drawn(svg('<use href="#ear" /><image href="#tile" width="4" height="4" />'))
  })

  test('whitespace around the document is not text after it', () => {
    drawn(`\n  ${svg('<circle cx="1" cy="1" r="1" />')}\n`)
  })
})

describe('a picture this app refuses', () => {
  test('a script in it, by name', () => {
    assert.match(refusal(svg('<script>fetch("//x")</script>')), /<script>/)
  })

  test('a foreignObject, whatever its case', () => {
    assert.match(refusal(svg('<foreignObject width="10" height="10"></foreignObject>')), /foreignobject/)
  })

  test('a link that leaves the document', () => {
    assert.match(refusal(svg('<a href="https://example.com/seen"><circle r="1" /></a>')), /linking to/)
  })

  test('a link that leaves it under the xlink name too', () => {
    assert.match(refusal(svg('<use xlink:href="https://example.com/x" />')), /linking to/)
  })

  test('a handler on anything', () => {
    assert.match(refusal(svg('<circle r="1" onload="x()" />')), /onload handler/)
  })

  test('a root that is not an svg', () => {
    assert.match(refusal('<html><body>hello</body></html>'), /<html> rather than <svg>/)
  })

  test('a second document after the first', () => {
    assert.match(refusal(`${svg('<circle r="1" />')}${svg('<circle r="2" />')}`), /more than one document/)
  })

  test('text after the document', () => {
    assert.match(refusal(`${svg('<circle r="1" />')} and then some`), /after the/)
  })

  test('a tag left open', () => {
    assert.match(refusal('<svg xmlns="http://www.w3.org/2000/svg"><g>'), /left open/)
  })

  test('a tag closed that was never opened', () => {
    assert.match(refusal(svg('</g>')), /never opened/)
  })

  test('a tag that never ends', () => {
    assert.match(refusal('<svg xmlns="http://www.w3.org/2000/svg"'), /never ends/)
  })

  test('a comment that never ends', () => {
    assert.match(refusal('<svg><!-- and then'), /comment that never ends/)
  })

  test('a doctype, which is where entity expansion lives', () => {
    assert.match(refusal('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>'), /doctype/)
  })

  test('a processing instruction', () => {
    assert.match(refusal('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'), /processing instruction/)
  })

  test('nothing at all', () => {
    assert.match(refusal(''), /empty/)
    assert.match(refusal('   '), /empty/)
  })

  test('something that is not text', () => {
    assert.match(refusal(null), /not text/)
    assert.match(refusal({ svg: '<svg/>' }), /not text/)
    assert.match(refusal(42), /not text/)
  })
})

describe('how much picture is too much', () => {
  test('a drawing right up to the limit is drawn', () => {
    const padding = LONGEST - new TextEncoder().encode(svg('')).length
    drawn(svg('x'.repeat(padding)))
  })

  test('one byte over is refused, and the refusal says how big it was', () => {
    const padding = LONGEST - new TextEncoder().encode(svg('')).length + 1
    assert.match(refusal(svg('x'.repeat(padding))), /KiB picture, over the 16 KiB limit/)
  })

  // The cap is on what has to be carried through an IPC message and a data
  // URI, and one of these is four bytes rather than one character.
  test('the limit counts bytes, not characters', () => {
    const padding = LONGEST - new TextEncoder().encode(svg('')).length
    assert.match(refusal(svg('🐁'.repeat(padding))), /over the 16 KiB limit/)
  })
})
