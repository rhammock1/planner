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
