// @ts-check

/**
 * Debug CLI: parse a vault file and show what the app sees.
 *
 *   node tools/dump.js path/to/2026-08-31.md          print the Document as JSON
 *   node tools/dump.js path/to/2026-08-31.md --canon  print canonical Markdown
 *   node tools/dump.js path/to/2026-08-31.md --check  report whether it round-trips
 *
 * Exit 2 means the file could not be read or the options were wrong. Exit 1
 * means --check found a non-canonical file.
 *
 * Not part of the app. Nothing imports this.
 */

import { readFileSync } from 'node:fs'
import { parse } from '../src/core/parse.js'
import { serialize } from '../src/core/serialize.js'

const [path, flag] = process.argv.slice(2)

if (path === undefined) {
  console.error('usage: node tools/dump.js <file.md> [--canon|--check]')
  process.exit(2)
}

let original
try {
  original = readFileSync(path, 'utf8')
} catch (error) {
  // Exit 2 for "could not read", so --check's exit 1 keeps meaning exactly one
  // thing: the file was read and is not canonical.
  console.error(`cannot read ${path}: ${error instanceof Error ? error.message : error}`)
  process.exit(2)
}

const doc = parse(original)

if (flag === '--canon') {
  process.stdout.write(serialize(doc))
} else if (flag === '--check') {
  const canonical = serialize(doc)
  if (canonical === original) {
    console.log(`${path}: canonical, round-trips exactly`)
  } else {
    console.log(`${path}: not canonical — the app would rewrite it on next save`)
    process.exitCode = 1
  }
} else if (flag === undefined) {
  console.log(JSON.stringify(doc, null, 2))
} else {
  console.error(`unknown option: ${flag}`)
  console.error('usage: node tools/dump.js <file.md> [--canon|--check]')
  process.exit(2)
}
