// @ts-check

/**
 * A sidecar: a file beside the day it belongs to (spec §4.1).
 *
 *     ~/Planner/2026/09/2026-09-01.md                    the day
 *     ~/Planner/2026/09/2026-09-01.meeting-standup.md    a sidecar
 *
 * Same folder, same date stem, then a suffix a plugin owns. The day model
 * never sees one: `pageForPath` reads the stem before `.md` and
 * `2026-09-01.meeting-standup` is not a date, so the index, the counts, the
 * horizon and carry-forward are untouched by a phase that adds files to the
 * vault. That is the property that makes the phase safe, and it is a property
 * of this file's rule.
 *
 * Pure, and shared. The app imports it and so does a plugin, because a
 * filename computed twice is a filename computed two ways: the plugin names
 * a note and the app opens one, and the two must be the same string.
 */

/** The longest a suffix may be, prefix and all. */
export const LONGEST_SUFFIX = 64

/** The longest a title's stem may be, before its prefix is put in front. */
export const LONGEST_STEM = 48

/**
 * The longest a prefix may be.
 *
 * Not a taste: `prefix` + `-` + a 48-character stem has to fit in 64, so
 * anything over fifteen is a plugin that can name `Standup` and cannot name
 * the meeting with the long title. Refused at the manifest, where a person
 * can see it, rather than on the day it bites.
 */
export const LONGEST_PREFIX = LONGEST_SUFFIX - LONGEST_STEM - 1

const SUFFIX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSuffix(value) {
  return typeof value === 'string' && value.length <= LONGEST_SUFFIX && SUFFIX.test(value)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPrefix(value) {
  return typeof value === 'string' && value.length <= LONGEST_PREFIX && SUFFIX.test(value)
}

/**
 * Where a sidecar lives, relative to the vault root.
 *
 * Mirrors `sidecar_path` in `src-tauri/src/vault_io/sidecars.rs`; the two must
 * agree, which is why both are one line over the same rule. Null rather than a
 * thrown error: a caller with a suffix from somebody else's code is asking a
 * question, not making a mistake.
 *
 * @param {string} date  `YYYY-MM-DD`. The back page has no date and no sidecars.
 * @param {string} suffix
 * @returns {string|null}
 */
export function sidecarPath(date, suffix) {
  if (typeof date !== 'string' || !DATE.test(date) || !isSuffix(suffix)) return null
  return `${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.${suffix}.md`
}

/**
 * Where a deleted note goes (spec §2.4).
 *
 * A move rather than an unlink: the vault is a folder of plain files somebody
 * owns, and an unrecoverable delete from a popover is a sharp edge on a
 * gesture that exists because notes get made by accident.
 *
 * Stamped with the second it went, because deleting the same suffix twice -
 * make a note, delete it, make it again, delete it again - is the ordinary
 * case rather than the odd one, and two files cannot share a name.
 *
 * A second is coarse enough that both of those deletes can land inside one,
 * so this is where the name *starts*: `trash` in
 * `src-tauri/src/vault_io/sidecars.rs` takes the first free one of this,
 * then `…{at}-2.md`, and so on. Nothing already in the bin is ever written
 * over, which is the whole of what moving a note aside promises.
 *
 * A dotfolder at the vault root, so `list` (which walks `YYYY/MM/`) never sees
 * one and a trashed note leaves no marker and no offer behind.
 *
 * @param {string} date  `YYYY-MM-DD`
 * @param {string} suffix
 * @param {number} at  Unix time, in whole seconds
 * @returns {string|null} null when this does not name a sidecar
 */
export function trashPath(date, suffix, at) {
  if (sidecarPath(date, suffix) === null) return null
  if (!Number.isSafeInteger(at) || at < 0) return null
  return `.trash/${date}.${suffix}.${at}.md`
}

/**
 * A title, as a filename can hold it (spec §4.2).
 *
 * Lowercased, everything else collapsed to single hyphens, cut, and *then*
 * trimmed - in that order, because a cut that lands inside a hyphen run
 * otherwise leaves a trailing one, which is not a legal suffix.
 *
 * @param {string} title
 * @returns {string} `''` when nothing survives
 */
export function stemOf(title) {
  if (typeof title !== 'string') return ''
  const collapsed = title.toLowerCase().replace(/[^a-z0-9]+/gu, '-')
  return collapsed.slice(0, LONGEST_STEM).replace(/^-+|-+$/gu, '')
}

/**
 * The suffix a title makes under a prefix.
 *
 * Two events with the same title on one day are one file, which is what a
 * person would do too.
 *
 * @param {string} prefix
 * @param {string} title
 * @returns {string} `''` when the title names nothing, or the prefix is not one
 */
export function suffixFor(prefix, title) {
  if (!isPrefix(prefix)) return ''
  const stem = stemOf(title)
  if (stem === '') return ''
  return `${prefix}-${stem}`
}

/**
 * Whether a suffix is one of these prefixes'.
 *
 * The prefix itself, or the prefix and a hyphen - never a bare string prefix,
 * which would give `meeting` the file `meetings-elsewhere` belongs to.
 *
 * @param {string[]} prefixes
 * @param {string} suffix
 * @returns {boolean}
 */
export function owns(prefixes, suffix) {
  return prefixes.some((prefix) => suffix === prefix || suffix.startsWith(`${prefix}-`))
}

/**
 * @param {string} date
 * @param {string} suffix
 * @returns {string}
 */
export function sidecarRef(date, suffix) {
  return `sidecar:${date}/${suffix}`
}

/**
 * The day and suffix an href names, or null for anything else.
 *
 * Everything that reaches this came from a plugin, so the shape is checked
 * before the string is believed - a suffix that climbs out of the folder is
 * refused here the same way an entry that climbs out of the vault already is.
 *
 * @param {unknown} href
 * @returns {{date: string, suffix: string}|null}
 */
export function readRef(href) {
  if (typeof href !== 'string') return null
  const rest = href.startsWith('sidecar:') ? href.slice('sidecar:'.length) : null
  if (rest === null) return null

  const cut = rest.indexOf('/')
  if (cut === -1) return null
  const date = rest.slice(0, cut)
  const suffix = rest.slice(cut + 1)
  if (!DATE.test(date) || !isSuffix(suffix)) return null
  return { date, suffix }
}

/**
 * Who owns which prefix, once every plugin has claimed (spec §4.1).
 *
 * Two enabled plugins with overlapping prefixes is a refusal of the second, in
 * name order - of the *prefix*, not of the plugin: a later plugin loses the
 * contested claim and keeps anything nobody else wanted. Name order rather
 * than the order the folders were read in, so the same two plugins settle the
 * same way on every launch.
 *
 * @param {{name: string, prefixes: string[]}[]} claims
 * @returns {{owned: Map<string, string[]>, notices: string[]}}
 */
export function settlePrefixes(claims) {
  /** @type {Map<string, string[]>} */
  const owned = new Map()
  /** @type {string[]} */
  const notices = []
  /** Every prefix taken so far, and who took it. @type {Map<string, string>} */
  const taken = new Map()

  for (const claim of [...claims].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
    /** @type {string[]} */
    const kept = []
    for (const prefix of claim.prefixes) {
      // Claimed twice by one plugin is claimed once. The list is a set of
      // things owned, and owning a thing twice owns nothing extra.
      if (kept.includes(prefix)) continue

      const clash = [...taken.entries()].find(([held]) => owns([held], prefix) || owns([prefix], held))
      if (clash !== undefined) {
        notices.push(`${claim.name} may not own the ${prefix} prefix; ${clash[1]} already owns ${clash[0]}`)
        continue
      }
      taken.set(prefix, claim.name)
      kept.push(prefix)
    }
    owned.set(claim.name, kept)
  }

  return { owned, notices }
}
