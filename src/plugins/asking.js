// @ts-check

/**
 * Which plugins are up, what has been asked of them, and what came back.
 *
 * Two things that are one thing: you cannot ask a plugin that is not running,
 * and the moment a plugin's record changes it is restarted and everything it
 * said becomes an answer to a question that is no longer being asked.
 *
 * Nothing here waits. A page draws with what the cache holds, asks for what it
 * does not, and is redrawn if an answer arrives. An answer whose key is no
 * longer current when it lands is dropped rather than drawn against the wrong
 * lines (spec §1.4).
 *
 * `config.toml` is not watched. An edit made in a text editor takes effect at
 * the next launch; a change made in the ⌘, pane takes effect at once, because
 * the pane writes the file and then calls `sync`.
 */

import { plan, diff, signature } from '../core/plugins.js'

/**
 * How many answers to keep across every slot at once.
 *
 * Enough for a week's seven columns and a few days either side of the one on
 * screen, and small enough that a month of browsing does not accumulate.
 */
const REMEMBERED = 32

/** @typedef {import('../core/plugins.js').Folder} Folder */
/** @typedef {import('../core/plugins.js').Start} Start */
/** @typedef {import('../core/config.js').PluginConfig} PluginConfig */
/** @typedef {{plugin: string, value: unknown}} Answer */
/**
 * What a plugin is doing, from the session rather than from either file.
 *
 * Written out rather than imported from `ipc/host.js`: that module reaches
 * `window`, and this one is on the path `test/**` type-checks with no DOM lib
 * (spec §11.4) - a type-only reference would still pull the whole module in.
 *
 * @typedef {{name: string, running: boolean, disabled: boolean, reason: string|null}} PluginState
 */

/**
 * @typedef {object} AskingDeps
 * @property {(grant: import('../core/plugins.js').Grant) => Promise<void>} startPlugin
 * @property {(name: string) => Promise<void>} stopPlugin
 * @property {(slot: string, now: {date: string, time: string}, params: Record<string, unknown>) => Promise<{answers: Answer[], notices: string[]}>} askPlugins
 * @property {() => Promise<PluginState[]>} pluginStates
 * @property {() => {date: string, time: string}} now
 * @property {() => void} onChanged  redraw: an answer landed, or a plugin moved
 */

/**
 * @param {AskingDeps} deps
 */
export function createAsking(deps) {
  /** What is running, and the record it was started with. @type {Map<string, string>} */
  const running = new Map()
  /** Answers, by slot *and* key. @type {Map<string, Answer[]>} */
  const held = new Map()
  /** The questions in the air, by the same compound key. @type {Set<string>} */
  const flying = new Set()
  /** The last thing that went wrong, per slot. @type {Map<string, string[]>} */
  const said = new Map()
  /** @type {PluginState[]} */
  let states = []
  /** Moves when the world may have changed under a plugin's feet. */
  let generation = 0
  /** Moves when a plugin starts or stops. Everything said before it was said
   *  by a different set of plugins, including the empty answer a page gets
   *  at launch, before the first plugin is up (spec §1.4). */
  let epoch = 0
  /** The last sync queued, so an overlapping call runs after it rather than
   *  racing it against the same pre-mutation `running` - the hazard
   *  `createWriteQueue` (writeQueue.js) exists for, here applied to plugins
   *  instead of pages. @type {Promise<void>} */
  let tail = Promise.resolve()

  /**
   * Brings what is running into line with what the two files say (spec §1.2).
   *
   * Queued rather than run at once: the popover calls this at boot and again
   * from the settings pane, and two calls diffing the same snapshot of
   * `running` could both decide to start the same plugin - one of the two
   * `start_plugin` calls is refused, with a notice for a plugin that in fact
   * started fine.
   *
   * @param {Folder[]} folders
   * @param {Map<string, PluginConfig>} configured
   * @returns {Promise<string[]>} notices
   */
  function sync(folders, configured) {
    const result = tail.then(() => settle(folders, configured))
    // Carries on after a failure: one sync that threw must not wedge every
    // sync queued behind it.
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * @param {Folder[]} folders
   * @param {Map<string, PluginConfig>} configured
   * @returns {Promise<string[]>} notices
   */
  async function settle(folders, configured) {
    const planned = plan(folders, configured)
    const change = diff(running, planned.start)
    /** @type {string[]} */
    const failures = []

    // Stops first, and awaited: `stop_plugin` does not resolve until the
    // webview is gone, so a start under the same name below cannot race it.
    /** Names whose webview would not go. @type {Set<string>} */
    const stuck = new Set()

    for (const name of change.stop) {
      try {
        await deps.stopPlugin(name)
        running.delete(name)
      } catch (error) {
        // Left in `running`, so the next sync tries the same stop again, and
        // no start is attempted under a label the old window still holds -
        // which `start` refuses anyway, with a second and more confusing line.
        stuck.add(name)
        failures.push(`Could not stop ${name}: ${message(error)}`)
      }
    }

    for (const one of change.start) {
      if (stuck.has(one.name)) continue
      try {
        // The whole record, as one thing. It grew a field twice in this phase
        // and each time that was seven edits across four files; the fields a
        // plugin is started with are one decision and travel as one (spec §7).
        await deps.startPlugin({ ...one, settings: Object.fromEntries(one.settings) })
        running.set(one.name, signature(one))
      } catch (error) {
        failures.push(`Could not start ${one.name}: ${message(error)}`)
      }
    }

    if (change.stop.length > 0 || change.start.length > 0) {
      // Everything held was an answer from a different set of plugins.
      // Cleared rather than filtered plugin by plugin: a plugin that has
      // just started said nothing there is anything to filter out, and it is
      // precisely its markers that are missing. Without this, ticking
      // `item.badge` leaves the day showing the empty answer it cached
      // before the plugin was up, until a line is edited or the day turns.
      epoch += 1
      held.clear()
      said.clear()
      await readStates()
    }
    return [...planned.notices, ...failures]
  }

  /**
   * What the plugins said about this question, asking if nobody has.
   *
   * The key is whatever makes an old answer wrong. Handing back `[]` on a miss
   * is not a failure - it is a page that has not been told yet, and will be
   * redrawn when it is.
   *
   * Kept by slot **and** key rather than one answer per slot, because the week
   * draws seven pages in one pass and every one of them asks `item.badge` with
   * a key of its own. A single-answer cache would have the seven evict each
   * other on every draw and ask fourteen questions a second.
   *
   * @param {string} slot
   * @param {string} key
   * @param {Record<string, unknown>} params
   * @returns {Answer[]}
   */
  function answers(slot, key, params) {
    const at = `${slot}\u0000${key}`
    const have = held.get(at)
    if (have !== undefined) return have

    if (!flying.has(at)) {
      flying.add(at)
      void run(slot, at, params)
    }
    return []
  }

  /**
   * @param {string} slot
   * @param {string} at  the compound key
   * @param {Record<string, unknown>} params
   * @returns {Promise<void>}
   */
  async function run(slot, at, params) {
    // Which set of plugins this question was put to. At launch the day page
    // asks a microtask before the first `start_plugin` goes out, so the
    // answer to this one can land *after* the plugin it was meant for is up;
    // kept, it would be an empty answer cached over a running plugin.
    const asked = epoch
    try {
      const given = await deps.askPlugins(slot, deps.now(), params)
      if (epoch === asked) {
        keep(at, given.answers)
        said.set(slot, given.notices)
      }
    } catch (error) {
      if (epoch === asked) {
        keep(at, [])
        said.set(slot, [`Could not ask the plugins: ${message(error)}`])
      }
    } finally {
      // Whether it was kept or dropped: dropped means the redraw below finds
      // a miss and asks again, of the plugins that are now running.
      flying.delete(at)
    }
    // The redraw does not wait on plugin states: it is the answer that was
    // worth waiting for. States are read afterward and, if a plugin has
    // meanwhile been put away, said again - a second, cheap redraw rather
    // than one page that never learns the state it drew was stale.
    deps.onChanged()
    await readStates()
    deps.onChanged()
  }

  /**
   * Remembers an answer, and forgets the oldest once there are too many.
   *
   * Bounded because the key of a day page is the day: walking a month back
   * would otherwise leave thirty answers in memory for pages nobody is
   * looking at. A `Map` iterates in insertion order, so the first key is the
   * least recently written one.
   *
   * @param {string} at
   * @param {Answer[]} answers
   * @returns {void}
   */
  function keep(at, answers) {
    held.set(at, answers)
    while (held.size > REMEMBERED) {
      const oldest = held.keys().next().value
      if (oldest === undefined) break
      held.delete(oldest)
    }
  }

  /** @returns {Promise<void>} */
  async function readStates() {
    try {
      states = await deps.pluginStates()
    } catch {
      // Not worth a notice: the pane loses a line of explanation, and
      // everything else about the plugin still works.
      states = []
    }
  }

  return {
    sync,
    answers,
    /**
     * A question asked and awaited, outside the cache.
     *
     * Everything else here is draw-on-miss, which is machinery for *not*
     * waiting: a page is never held up by somebody else's code. An action is
     * a gesture rather than a draw - a person pressed a chord, no older
     * answer could be right, and the caller has nothing to show until this
     * one lands. So it takes no key, writes nothing to `held`, and forces no
     * redraw; what the answer means is the caller's to decide (spec §4.3).
     *
     * Rejects if the door does. There is no cached answer to fall back on and
     * no page waiting on it, so the caller is the right place for a failure
     * to be said out loud.
     *
     * @param {string} slot
     * @param {Record<string, unknown>} params
     * @returns {Promise<{answers: Answer[], notices: string[]}>}
     */
    once: (slot, params) => deps.askPlugins(slot, deps.now(), params),
    /** The counter a generation-forced key is built from (spec §1.4). */
    generation: () => generation,
    /** The world moved: the popover opened, or the schedule was refreshed. */
    refresh: () => { generation += 1 },
    /** One line each, replaced every ask rather than piled up. */
    notices: () => [...said.values()].flat(),
    states: () => states,
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
