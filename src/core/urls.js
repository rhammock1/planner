// @ts-check

/**
 * What a plugin may open (spec §2.1).
 *
 * A URL is the one way a plugin's output leaves the machine, so the grant is
 * narrow and stated: a badge can carry the text of a line into a URL, and the
 * URL goes to a host the person named in the pane.
 *
 * The comparison is on parsed URLs, not on strings. A string-prefix check
 * passes `https://github.com.evil.io/…` and
 * `https://github.com/org/repo/../../evil/`, and both of those leave the
 * machine for somewhere nobody approved.
 *
 * This is not the boundary — Rust checks again before anything is opened, and
 * that check is the one that counts. This one is here so the pane can show a
 * resolved prefix and a refused click can say so without a round trip.
 */

/** A prefix must end in one, or `…/gotab` would approve `…/gotabbing`. */
const ENDS_IN_SLASH = /\/$/

/**
 * Reads one entry of `[permissions.open].urls`.
 *
 * @param {string} entry
 * @returns {{prefix: string, error: string|null}}
 */
export function readPrefix(entry) {
  /** @param {string} error */
  const bad = (error) => ({ prefix: '', error })

  const url = parse(entry)
  if (url === null) return bad(`${entry} is not a URL`)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return bad(`${entry} is not an https or http address`)
  }
  // Credentials in a URL are a way to hand a host something that is not the
  // path, and nothing this app opens needs them.
  if (url.username !== '' || url.password !== '') {
    return bad(`${entry} carries a username, which is not allowed`)
  }
  if (!ENDS_IN_SLASH.test(url.pathname)) {
    return bad(`${entry} does not end in a slash, so it is not a folder of addresses`)
  }
  return { prefix: url.href, error: null }
}

/**
 * Whether a URL falls under any of the approved prefixes.
 *
 * @param {string} href  whatever the plugin sent
 * @param {string[]} prefixes  already resolved and read
 * @returns {boolean}
 */
export function mayOpen(href, prefixes) {
  const target = parse(href)
  if (target === null) return false
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
  if (target.username !== '' || target.password !== '') return false

  return prefixes.some((entry) => {
    const prefix = parse(entry)
    if (prefix === null) return false
    if (prefix.protocol !== target.protocol) return false
    if (prefix.hostname !== target.hostname) return false
    // `port` is '' for the scheme's own port, so `https://x/` and
    // `https://x:443/` compare equal, which is the same address.
    if (prefix.port !== target.port) return false
    return under(segments(prefix.pathname), segments(target.pathname))
  })
}

/**
 * The path as a list, with the empty step a trailing slash leaves dropped.
 *
 * Compared step by step rather than as text: `…/node/pull/` must not approve
 * `…/nodex/pull/`, and only a segment comparison says so.
 *
 * @param {string} path  already normalised by `URL`
 * @returns {string[]}
 */
function segments(path) {
  return path.split('/').filter((step) => step !== '')
}

/**
 * @param {string[]} prefix
 * @param {string[]} target
 * @returns {boolean}
 */
function under(prefix, target) {
  if (target.length < prefix.length) return false
  return prefix.every((step, at) => target[at] === step)
}

/**
 * @param {string} text
 * @returns {URL|null}
 */
function parse(text) {
  try {
    return new URL(text)
  } catch {
    return null
  }
}
