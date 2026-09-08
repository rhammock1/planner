// @ts-check

/**
 * A command a plugin may run, as a manifest declares it and as a person reads
 * it (spec §1.6, §3.2).
 *
 * There is no shell anywhere in this. A command is an argument list, and the
 * one thing this module produces is a *rendering* of that list for a human
 * being to look at in the settings pane and in `config.toml`. Nothing here
 * ever produces something that is then parsed back into arguments.
 *
 * The rendering is a rule rather than a habit, because approval works by
 * reading: the pane shows the line, `config.toml` holds the line, and a
 * manifest whose command no longer renders to the stored line shows up as
 * unapproved. An unstated rendering could not be reproduced by the person
 * approving it, which would make that whole mechanism a bluff.
 */

import { isBareKey } from './toml.js'

/**
 * Characters an argument may be made of and still be shown bare.
 *
 * A safe set rather than a list of offenders, because the offenders are the
 * ones nobody thought of: a tab, a non-breaking space and a right-to-left
 * override are all invisible or space-like when the pane draws them, and a
 * rule written as "quote a space, a quote or an apostrophe" lets every one of
 * them through. Then two different argument lists render to the same line and
 * approval by reading has quietly stopped working.
 */
const SAFE = /^[A-Za-z0-9_@%+=:,./{}-]+$/

/**
 * One argument list, as one line, with each placeholder saying what binds it.
 *
 * Join with single spaces; anything outside `SAFE` is wrapped in single quotes
 * with an inner `'` written as `'\''`. There is no shell at the other end of
 * this - the quoting is for the person reading, and for the Copy button beside
 * the line, which does put it somewhere a shell will read it.
 *
 * The rule travels inside the placeholder (`{repo=settings.repo}`) because the
 * stored string is the approval. A second version of a plugin that kept its
 * arguments and moved `{repo}` from `settings.repo` to `settings.token` would
 * otherwise render byte-identically and keep its tick, while a different value
 * went onto the command line.
 *
 * Total: a placeholder with no bind renders as it stands. This describes an
 * argument list, it does not vet one - `readRun` does that.
 *
 * @param {string[]} args
 * @param {import('./permissions.js').RunBind[]} binds
 * @returns {string}
 */
export function renderCommand(args, binds) {
  const rules = new Map(binds.map((bind) =>
    [bind.name, bind.rule === 'date' ? 'date' : `settings.${bind.key}`]))
  return args
    .map((argument) => argument.replace(
      /\{([A-Za-z0-9_-]+)\}/g,
      (whole, name) => {
        const rule = rules.get(name)
        return rule === undefined ? whole : `{${name}=${rule}}`
      },
    ))
    .map(quote)
    .join(' ')
}

/**
 * @param {string} argument
 * @returns {string}
 */
function quote(argument) {
  if (SAFE.test(argument)) return argument
  return `'${argument.replaceAll("'", "'\\''")}'`
}

/**
 * Every `{name}` in an argument list, in the order they first appear.
 *
 * A placeholder lives inside one argument and is substituted inside it, so the
 * list stays the length the manifest wrote it. One that opened in an argument
 * and closed in the next would put a bound value in charge of how many
 * arguments there are, which is the whole thing an argument list exists to
 * prevent - so it is refused rather than read across.
 *
 * @param {string[]} args
 * @returns {{names: string[], error: string|null}}
 */
export function placeholdersOf(args) {
  /** @type {string[]} */
  const names = []

  for (const argument of args) {
    let at = 0
    while (at < argument.length) {
      const opens = argument.indexOf('{', at)
      const closes = argument.indexOf('}', at)
      if (opens === -1 && closes === -1) break
      if (opens === -1 || (closes !== -1 && closes < opens)) {
        return { names: [], error: `${argument} closes a placeholder it did not open` }
      }

      const ends = argument.indexOf('}', opens + 1)
      if (ends === -1) {
        return { names: [], error: `${argument} opens a placeholder it does not close` }
      }

      const name = argument.slice(opens + 1, ends)
      if (!isBareKey(name)) {
        return { names: [], error: `${argument} names a placeholder this app cannot bind: {${name}}` }
      }
      if (!names.includes(name)) names.push(name)
      at = ends + 1
    }
  }
  return { names, error: null }
}
