// @ts-check

/**
 * Three plugins carry their own copies of a core module's declarations.
 * `plugins/macos-calendar/index.js` and `plugins/task-notes/index.js` copy
 * from `src/core/sidecars.js`, and `plugins/kanban/index.js` copies the
 * parsing half of `src/core/board.js`. This is not an oversight to clean up:
 * a plugin is installed by copying its own folder alone, and served from an
 * origin that refuses any path climbing out of that folder, so an `import`
 * reaching back into `src/` would type-check in this repo and 404 the moment
 * the plugin was actually installed. Duplication is the only way a plugin can
 * name a sidecar or read its own board file at all.
 *
 * What that buys is a second (and third) place for the copies to disagree,
 * and the symptom of disagreement is quiet in both directions: a sidecar
 * plugin computes a filename the app then cannot find, and the board draws a
 * file that is not the one on disk - parsing its own columns differently than
 * the app writes them. There is no behavioural test for either from the
 * plugin's side, because the helpers are not exported, so this test reads the
 * files as text and holds each declaration's source against its twin, byte
 * for byte.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Every plugin that carries copies of a core module's declarations, and what
 * it copies. A plugin that names a sidecar or reads a board file has to be
 * here: the copies are the only way it can do either, and this is the only
 * thing holding them to the original.
 */
const COPIES = [
  {
    plugin: 'macos-calendar',
    core: 'sidecars',
    functions: ['stemOf', 'isPrefix', 'suffixFor', 'sidecarRef'],
    constants: ['LONGEST_SUFFIX', 'LONGEST_STEM', 'LONGEST_PREFIX', 'SUFFIX'],
  },
  {
    plugin: 'task-notes',
    core: 'sidecars',
    functions: ['stemOf', 'isPrefix', 'suffixFor', 'sidecarRef'],
    constants: ['LONGEST_SUFFIX', 'LONGEST_STEM', 'LONGEST_PREFIX', 'SUFFIX'],
  },
  {
    plugin: 'kanban',
    core: 'board',
    functions: ['cardOf', 'parseBoard'],
    constants: ['CARD', 'HEADING', 'FRESH'],
  },
]

/**
 * The source of one top-level declaration, from its `function name(` or
 * `const NAME` line to the next line that is exactly `}` (a function body)
 * or to the end of that same line (a one-line `const`).
 *
 * A leading `export ` is stripped before matching and before comparing -
 * that is the only difference the two files are allowed to have. Fails the
 * calling test, rather than returning nothing, when `name` is not declared
 * in `source` at all: a helper missing from one side is exactly the drift
 * this test exists to catch, not a reason to compare fewer things.
 *
 * @param {string} source
 * @param {'function'|'const'} kind
 * @param {string} name
 * @param {string} fileLabel  for the failure message, when nothing is found
 * @returns {string}
 */
function declarationOf(source, kind, name, fileLabel) {
  const lines = source.split('\n').map((line) => (line.startsWith('export ') ? line.slice('export '.length) : line))
  const starter = kind === 'function' ? new RegExp(`^function ${name}\\(`) : new RegExp(`^const ${name}\\b`)
  const start = lines.findIndex((line) => starter.test(line))
  assert.notEqual(start, -1, `${fileLabel} does not declare ${kind} ${name}`)

  const startLine = lines[start]
  if (startLine === undefined || !startLine.trimEnd().endsWith('{')) {
    // A one-line const: the whole declaration is this line.
    return startLine ?? ''
  }

  const end = lines.findIndex((line, index) => index > start && line.trim() === '}')
  assert.notEqual(end, -1, `${fileLabel}'s ${name} opens a block that never closes on a line of its own "}"`)
  return lines.slice(start, end + 1).join('\n')
}

for (const { plugin, core, functions, constants } of COPIES) {
  test(`${plugin}' copied helpers match src/core/${core}.js`, () => {
    const coreLabel = `src/core/${core}.js`
    const coreSource = readFileSync(fileURLToPath(new URL(`../src/core/${core}.js`, import.meta.url)), 'utf8')
    const label = `plugins/${plugin}/index.js`
    const source = readFileSync(fileURLToPath(new URL(`../plugins/${plugin}/index.js`, import.meta.url)), 'utf8')

    for (const declared of functions) {
      assert.equal(
        declarationOf(source, 'function', declared, label),
        declarationOf(coreSource, 'function', declared, coreLabel),
        `function ${declared} has drifted between ${label} and ${coreLabel}`,
      )
    }

    for (const declared of constants) {
      assert.equal(
        declarationOf(source, 'const', declared, label),
        declarationOf(coreSource, 'const', declared, coreLabel),
        `const ${declared} has drifted between ${label} and ${coreLabel}`,
      )
    }
  })
}
