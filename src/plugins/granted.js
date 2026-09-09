// @ts-check

/**
 * What the two files grant each plugin, as a window needs to read it.
 *
 * `installed()` is the pure reader: folders and config in, a record per plugin
 * out. This is the half that sits between it and a drawing window - it caches
 * the parse, and it answers the two questions a draw actually asks, which are
 * about grants rather than about plugins.
 *
 * Its own file because the store was over three hundred lines and this is the
 * part of it that is not about the vault. It also makes the rule below
 * testable without building a store: which plugin may move which colour is a
 * decision with three inputs, and it was previously reachable only through a
 * window.
 */

import { installed } from '../core/installed.js'
import { settlePrefixes } from '../core/sidecars.js'

/** @typedef {import('../core/installed.js').Installed} Installed */
/** @typedef {import('../core/plugins.js').Folder} Folder */
/** @typedef {import('../core/config.js').PluginConfig} PluginConfig */

/** As much of a plugin's state as this file has any business knowing. Written
 *  out rather than imported from `ipc/host.js`: that module reaches for
 *  `window`, and dragging the browser in would put this beyond the reach of
 *  `node --test`. What is actually needed here is two fields.
 *  @typedef {{name: string, disabled: boolean}} Standing */

/**
 * @typedef {object} Granted
 * @property {() => Installed[]} installed  every plugin the two files describe
 * @property {(name: string) => string[]} approvedOpen  addresses it may open
 * @property {() => Map<string, string[]>} moves  who may move which token
 * @property {() => Map<string, string[]>} prefixes  who owns which sidecar prefix
 */

/**
 * @param {object} reading  getters, because all three move under the window
 * @param {() => Folder[]} reading.folders
 * @param {() => Map<string, PluginConfig>} reading.plugins
 * @param {() => Standing[]} reading.states
 * @returns {Granted}
 */
export function createGranted(reading) {
  /** What was last worked out, and what it was worked out from.
   *  @type {{folders: unknown, plugins: unknown, list: Installed[]}|null} */
  let known = null

  /**
   * Memoized because `installed()` reads and parses every manifest in the
   * folder, and this is on the day page's draw path - which is every keystroke
   * in the add row. Both inputs are replaced wholesale when they change, so
   * identity is the whole test.
   *
   * @returns {Installed[]}
   */
  function all() {
    const folders = reading.folders()
    const plugins = reading.plugins()
    if (known === null || known.folders !== folders || known.plugins !== plugins) {
      known = { folders, plugins, list: installed(folders, plugins) }
    }
    return known.list
  }

  return {
    installed: all,

    // The same list the pane ticks, computed from the two files rather than
    // from whatever a window happens to have started a plugin with - so the
    // spread, which asks plugins but starts none (spec §1.3), gets the same
    // answer as the popover.
    approvedOpen: (name) => all().find((one) => one.name === name)?.approvedOpen ?? [],

    // Enabled, ticked for the slot, and ticked for the colour: a slot that
    // hands over a list is granted by the list, not by the slot's name
    // (spec §1.1).
    //
    // A claim is what stops a second plugin moving the same colour, so a
    // plugin that is not up must not hold one - it would refuse a running
    // plugin a token and put a notice on the page naming a plugin that is not
    // even there (spec §3.3). Switched off is handled by `enabled`; put away
    // for the session is not, because it is not one of the two things the
    // memo is keyed on and can happen at any moment.
    moves: () => {
      const away = new Set(reading.states().filter((one) => one.disabled).map((one) => one.name))
      return new Map(
        all()
          .filter((one) => one.enabled && one.approvedSlots.includes('theme.tokens'))
          .filter((one) => !away.has(one.name))
          .map((one) => [one.name, one.approvedMoves]),
      )
    },

    // Enabled only, and settled here rather than read off `plan()`: the spread
    // window asks plugins and starts none (spec §1.3), so it has no plan to
    // read - and both windows must agree about whose file a `sidecar:` href
    // names.
    prefixes: () => settlePrefixes(
      all().filter((one) => one.enabled).map((one) => ({ name: one.name, prefixes: one.prefixes })),
    ).owned,
  }
}
