// @ts-check

/**
 * What `planner.d.ts` promises, checked by using it.
 *
 * Not a plugin: there is no folder, no manifest and nothing imports it. It is
 * here because `tsconfig.web.json` type-checks `plugins/**`, which makes a
 * declaration that must hold a thing the type-checker can be asked about.
 */

/**
 * A setting the manifest declared with no `default` and nobody has set is
 * absent from what the plugin is handed - `settled` (src/core/pluginSettings.js)
 * leaves the key out rather than putting an empty value in, which is why
 * `ticket-links` writes `String(planner.settings.url ?? '')`. Declared as a
 * value that is always there, this line would not compile, and an author
 * following the declaration would write `planner.settings.url.replace(...)`
 * and get a `TypeError` on a fresh install instead.
 *
 * @type {typeof planner.settings}
 */
const withOneUnset = { url: undefined }
void withOneUnset

/**
 * What storage hands back is `unknown`, and that is the promise being kept.
 *
 * The file is JSON somebody may have edited, and a declaration that said
 * otherwise - `Promise<any>`, or a generic the caller fills in - would let an
 * author write `(await planner.storage.get('history')).length` and compile.
 * `pet` has to narrow what it reads before it believes it, and so does
 * everyone else; this line is what makes the type-checker say so.
 *
 * @returns {Promise<number>}
 */
async function narrowedBeforeItIsBelieved() {
  const stored = await planner.storage.get('history')
  return Array.isArray(stored) ? stored.length : 0
}
void narrowedBeforeItIsBelieved

/** Forgetting a key is `set` with nothing to set, which has to compile.
 *  @type {Promise<void>[]} */
const bothWaysToSet = [planner.storage.set('history'), planner.storage.set('history', [1, 2])]
void bothWaysToSet
