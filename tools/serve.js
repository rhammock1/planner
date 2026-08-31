// @ts-check

/**
 * A static file server for the browser checks in `test/browser/`, and for
 * opening `src/index.html` without building the Tauri shell.
 *
 * Not part of the app. Modules cannot be imported over `file://`, so looking
 * at the frontend in a plain browser needs something to serve it; this is the
 * smallest thing that does, and it sends `no-store` so a reload always runs
 * the code that is on disk rather than a cached copy.
 *
 * Usage: `npm run serve`, then open http://127.0.0.1:8731/src/index.html
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const PORT = 8731
const ROOT = resolve(import.meta.dirname, '..')

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const server = createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, normalize(decodeURIComponent(path)))

  // normalize() resolves `..` before this check, so a path that climbs out of
  // the project cannot be requested.
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end('outside the project')
    return
  }

  try {
    const body = await readFile(file)
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    response.end(body)
  } catch {
    response.writeHead(404).end(`no such file: ${path}`)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`serving ${ROOT} on http://127.0.0.1:${PORT}\n`)
})
