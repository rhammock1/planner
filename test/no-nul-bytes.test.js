// @ts-check

/**
 * A NUL byte (0x00) sitting where source should carry a six-character
 * escape sequence is invisible to every other check this project runs: the
 * runtime string is identical either way, so `node --test` passes and `tsc`
 * is clean whichever one is on disk. The only thing that notices is git,
 * and it does not raise an error - it silently reclassifies the file as
 * binary, which means the file can no longer be diffed, blamed, or
 * reviewed as a patch. That happened three times on this branch. Twice it
 * went unnoticed; once it was caught only because a person read a
 * `Bin 0 -> 4959 bytes` line in a diff and thought it looked wrong for a
 * JavaScript file. This test is the check that does not depend on somebody
 * reading that line.
 *
 * The file list comes from `git ls-files -z` rather than a directory walk,
 * so it follows `.gitignore` and never wanders into `node_modules` or
 * `src-tauri/target`. A handful of tracked files are genuinely binary and
 * are supposed to hold arbitrary bytes, NULs included; `BINARY_EXTENSIONS`
 * below is a fixed, hand-checked list of those (verified with `file`, not
 * assumed from the name), not a live "ask git" query - asking git whether a
 * file is binary means asking whether it contains a NUL byte, which is
 * exactly the question this test exists to answer for itself. A filter
 * built on that question would quietly exempt the very files it should
 * catch.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Extensions that are genuinely binary among today's tracked files, checked
 * with `file` rather than guessed. `src-tauri/icons/icon.png` is the only
 * one; no `.woff2` is tracked yet (the roadmap notes the fonts are not
 * bundled), so it is not listed here - add it, checked the same way, the
 * day one lands.
 */
const BINARY_EXTENSIONS = ['.png']

test('no tracked text file contains a NUL byte', () => {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  const files = listing.split('\u0000').filter((name) => name !== '')
  assert.ok(files.length > 0, 'git ls-files -z returned nothing; check the working directory')

  for (const relative of files) {
    if (BINARY_EXTENSIONS.includes(path.extname(relative))) continue

    const buffer = readFileSync(path.join(ROOT, relative))
    const offset = buffer.indexOf(0)
    assert.equal(offset, -1, `${relative} contains a NUL byte at offset ${offset}`)
  }
})
