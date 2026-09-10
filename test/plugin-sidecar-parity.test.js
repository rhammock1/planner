// @ts-check

/**
 * `plugins/macos-calendar/index.js` and `plugins/task-notes/index.js` each
 * carry their own copies of a handful of `src/core/sidecars.js` declarations
 * - `stemOf`, `isPrefix`, `suffixFor`, `sidecarRef`, and the constants
 * `LONGEST_SUFFIX`, `LONGEST_STEM`, `LONGEST_PREFIX` and `SUFFIX`. This is
 * not an oversight to clean up: a plugin is installed by copying its own
 * folder alone, and served from an origin that refuses any path climbing out
 * of that folder, so an `import` reaching back into `src/` would type-check
 * in this repo and 404 the moment the plugin was actually installed.
 * Duplication is the only way a plugin can name a sidecar at all.
 *
 * What that buys is a second (and third) place for the copies to disagree,
 * and the symptom of disagreement is quiet: the plugin computes a filename
 * the app then cannot find. There is no behavioural test for that - the
 * helpers are not exported from the plugins, and `import`-ing a plugin
 * module runs `planner.on(...)` against a `planner` global that only exists
 * inside the app - so this test reads the files as text and holds each
 * declaration's source against its twin, byte for byte.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CORE_PATH = fileURLToPath(new URL('../src/core/sidecars.js', import.meta.url))

/** Every plugin that carries copies of `src/core/sidecars.js` declarations.
 *  A plugin that names a sidecar has to be here: the copies are the only way
 *  it can name one, and this is the only thing holding them to the original. */
const PLUGINS = ['macos-calendar', 'task-notes']

/** The functions the plugins copy from the core module. */
const FUNCTIONS = ['stemOf', 'isPrefix', 'suffixFor', 'sidecarRef']

/** The top-level constants the plugins copy from the core module. */
const CONSTANTS = ['LONGEST_SUFFIX', 'LONGEST_STEM', 'LONGEST_PREFIX', 'SUFFIX']

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

for (const name of PLUGINS) {
  test(`${name}' copied sidecar helpers match src/core/sidecars.js`, () => {
    const core = readFileSync(CORE_PATH, 'utf8')
    const label = `plugins/${name}/index.js`
    const plugin = readFileSync(fileURLToPath(new URL(`../plugins/${name}/index.js`, import.meta.url)), 'utf8')

    for (const declared of FUNCTIONS) {
      assert.equal(
        declarationOf(plugin, 'function', declared, label),
        declarationOf(core, 'function', declared, 'src/core/sidecars.js'),
        `function ${declared} has drifted between ${label} and src/core/sidecars.js`,
      )
    }

    for (const declared of CONSTANTS) {
      assert.equal(
        declarationOf(plugin, 'const', declared, label),
        declarationOf(core, 'const', declared, 'src/core/sidecars.js'),
        `const ${declared} has drifted between ${label} and src/core/sidecars.js`,
      )
    }
  })
}
