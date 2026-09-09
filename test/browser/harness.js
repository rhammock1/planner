// @ts-check

/**
 * A test harness for the handful of things that can only be checked in a real
 * browser: focus, selection, and the caret.
 *
 * Everything else belongs under `node --test`, which runs in half a second
 * without one. Open any page in `test/browser/` to see the results, or drive
 * it from a browser automation tool and read `window.__testResults`.
 */

/** @typedef {{name: string, error: string|null}} Result */

/** @type {Result[]} */
const results = []

/**
 * `body` may be async - forcing a write with `blur()` still leaves the
 * handler's own promise to settle, and a caller that needs to see past that
 * `await`s the promise this returns. But every existing page in this folder
 * calls `check` without awaiting and then calls `report()` right after, so
 * async support has to be opt-in at the point of use: only a `body` that
 * actually returns a thenable defers the push, and by even one microtask -
 * exactly long enough for `report()` to have already run.
 *
 * @param {string} name
 * @param {() => void|Promise<void>} body
 * @returns {void|Promise<void>}
 */
export function check(name, body) {
  try {
    const value = body()
    if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
      return value.then(
        () => { results.push({ name, error: null }) },
        (error) => { results.push({ name, error: error instanceof Error ? error.message : String(error) }) },
      )
    }
    results.push({ name, error: null })
  } catch (error) {
    results.push({ name, error: error instanceof Error ? error.message : String(error) })
  }
  return undefined
}

/**
 * @param {boolean} condition
 * @param {string} message
 * @returns {asserts condition}
 */
export function ok(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} message
 * @returns {void}
 */
export function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

/**
 * Renders the results and publishes them for an automated run.
 *
 * @returns {void}
 */
export function report() {
  const failures = results.filter((result) => result.error !== null)
  Object.defineProperty(window, '__testResults', {
    value: {
      total: results.length,
      failed: failures.length,
      failures: failures.map((result) => `${result.name}: ${result.error ?? ''}`),
    },
    configurable: true,
  })

  const list = document.createElement('ul')
  for (const result of results) {
    const item = document.createElement('li')
    item.textContent = `${result.error === null ? 'PASS' : 'FAIL'}  ${result.name}${result.error === null ? '' : ` - ${result.error}`}`
    item.style.color = result.error === null ? '#17605B' : '#A8452C'
    list.append(item)
  }
  const heading = document.createElement('h1')
  heading.textContent = `${results.length - failures.length}/${results.length} passing`
  document.body.append(heading, list)
}
