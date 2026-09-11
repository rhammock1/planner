// @ts-check

/**
 * What a file opened by name is called, and where it sits (spec §3.4).
 *
 * Pure string work over a path the shell has already resolved: no IO, no
 * `node:path` - this module is loaded by the browser as well as by the test
 * runner - and nothing in it knows what a day is. That last part is the
 * point. A file opened by name is not a page and not a file beside one; it is
 * not indexed, not counted and never carried forward, and the way to keep
 * that true is for the code about it to have no vocabulary for any of it.
 *
 * macOS only (spec §2), so the separator is `/` and there is one of them.
 */

/**
 * Whether this app will open the file at all.
 *
 * The view renders Markdown, so a path that is not Markdown would be drawn as
 * something other than what the file says. Case-insensitive because a file
 * named on a case-insensitive filesystem is named however it was typed.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isMarkdownPath(path) {
  return /\.md$/iu.test(path)
}

/**
 * The last segment of a path.
 *
 * @param {string} path
 * @returns {string}
 */
export function nameOf(path) {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * The folder holding a file. `''` for a bare name with no folder in it.
 *
 * @param {string} path
 * @returns {string}
 */
export function folderOf(path) {
  const cut = path.lastIndexOf('/')
  if (cut === -1) return ''
  // A file at the filesystem root: the folder is `/`, not the empty string
  // that slicing to zero would give.
  return cut === 0 ? '/' : path.slice(0, cut)
}

/**
 * What the window calls the file.
 *
 * Its own first `# ` line, which is the one thing this app reads out of such
 * a file - the same single exception `list_sidecars` already makes, for the
 * same reason: a list needs something to call a file, and the words at the
 * top of it are yours (spec §2.1).
 *
 * The filename is the fallback, without its extension. An empty heading is
 * not a name, so it falls back too.
 *
 * @param {string} text
 * @param {string} path
 * @returns {string}
 */
export function titleOf(text, path) {
  const heading = text.split('\n').find((line) => line.startsWith('# '))
  const named = heading === undefined ? '' : heading.slice(2).trim()
  if (named !== '') return named
  return nameOf(path).replace(/\.md$/iu, '')
}

/**
 * Whether a path is inside the vault, and therefore whether the watcher will
 * ever say anything about it (spec §2.5).
 *
 * The separator is part of the comparison: `~/Planner-old` starts with
 * `~/Planner` and is a different folder, and a bare `startsWith` would put a
 * file in a vault it is not in - and then tell the person their file is being
 * watched when nothing is watching it.
 *
 * @param {string} path
 * @param {string} root  the vault root, absolute, with `~` already resolved
 * @returns {boolean}
 */
export function insideVault(path, root) {
  if (root === '') return false
  if (path === root) return true
  return path.startsWith(root.endsWith('/') ? root : `${root}/`)
}
