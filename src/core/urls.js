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
  // A query or a fragment is shown on the tick and never compared: `mayOpen`
  // reads scheme, host, port and path segments, so
  // `https://github.com/?a=/org/repo/pull/` would sit on its checkbox
  // reading as one repository's pull requests and approve the whole host.
  // Refusing it is what keeps the pane's label and the enforced scope the
  // same string.
  // Compared against the whole href rather than against `search` and `hash`,
  // which are both '' for a bare trailing `?` or `#` that `href` still keeps -
  // and it is `href` that gets stored and shown. Rust's `parse_prefix` reads
  // those as `Some("")` and refuses them, so this is also what keeps the two
  // sides answering the same question.
  if (url.href !== `${url.origin}${url.pathname}`) {
    return bad(`${entry} carries a query or a fragment, which is not part of an approved folder of addresses`)
  }
  if (!ENDS_IN_SLASH.test(url.pathname)) {
    return bad(`${entry} does not end in a slash, so it is not a folder of addresses`)
  }
  return { prefix: url.href, error: null }
}

/**
 * One entry of `[permissions.open].urls`, which is either a literal address or
 * the name of one of the plugin's own settings.
 *
 * A setting-derived prefix is the setting's value cut at its first `$`: the
 * setting is a template — `https://github.com/org/repo/pull/$1` — and the part
 * before the first placeholder is the fixed part that can be approved. With no
 * value there is no prefix and nothing opens.
 *
 * This is what lets a person whose tickets are not on the author's host use
 * the plugin at all: the URL is theirs, typed into the pane, and typing it is
 * the approval (spec §2.1).
 *
 * @param {string} entry
 * @param {Map<string, string|number|boolean>} settings
 * @returns {{prefix: string, error: string|null}}
 */
export function resolvePrefix(entry, settings) {
  if (!entry.startsWith('settings.')) return readPrefix(entry)

  const key = entry.slice('settings.'.length)
  const value = settings.get(key)
  if (typeof value !== 'string' || value === '') {
    return { prefix: '', error: `${key} has not been set, so nothing can be opened` }
  }
  const [fixed] = value.split('$')
  return readPrefix(fixed ?? '')
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
