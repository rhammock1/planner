// @ts-check

/**
 * The `planner` object a plugin is given (spec §7.3).
 *
 * This file is not loaded by the app. It is baked into the binary and served
 * as the first script of every plugin's page, before the plugin's own code
 * runs, so a plugin cannot replace what stands between it and the app.
 *
 * It is deliberately thin. Nothing here is a security boundary: a plugin can
 * rewrite every line of it, because it is running in the plugin's own webview.
 * What actually stops a plugin is on the other side of `invoke` - the one
 * command it is allowed to call, and the manifest check waiting there.
 */

;(() => {
  /** @type {Map<string, (message: any) => unknown>} */
  const handlers = new Map()

  /**
   * The name the host used to send for what is now `vault.contribute`.
   *
   * `docs/plugins.md` is a contract, so a plugin that registered under the old
   * name still answers the question. One entry, and it does not grow: a slot
   * introduced from here on has one name.
   */
  const ALSO_KNOWN_AS = new Map([['contribute', 'vault.contribute']])

  /**
   * @param {object} message
   * @returns {Promise<any>}
   */
  function send(message) {
    const internals = /** @type {any} */ (window).__TAURI_INTERNALS__
    if (internals === undefined) return Promise.reject(new Error('no host'))
    return internals.invoke('plugin_message', { message })
  }

  const planner = {
    /**
     * Answer a question the app puts to this plugin. The name is the slot,
     * exactly as `manifest.toml` declares it.
     * @param {string} slot
     * @param {(message: any) => unknown} handler
     */
    on(slot, handler) {
      handlers.set(slot, handler)
    },

    /**
     * Supply items for a range of days. The first slot there was, and the
     * name `docs/plugins.md` has always used for it.
     * @param {(range: {from: string, to: string}) => unknown} handler
     */
    onContribute(handler) {
      handlers.set('vault.contribute', handler)
    },

    /**
     * Reach something native. Refused unless the manifest asked for this
     * capability and the config granted it.
     * @param {string} capability
     */
    capability(capability) {
      return {
        /** @param {{from: string, to: string}} params */
        events: (params) => send({ kind: 'capability', capability, method: 'events', params }),
      }
    },

    /**
     * This plugin's own settings, as `config.toml` holds them.
     *
     * A getter over what the page wrote, because `runtime.js` runs first and
     * the value does not exist yet when this object is built. Frozen by the
     * page, and it never changes under running code: a change in the pane
     * restarts the plugin (spec §1.2).
     */
    get settings() {
      return /** @type {any} */ (window).__planner?.settings ?? {}
    },
  }

  /**
   * The app asking this plugin something. Called by the host, by injection -
   * never by the plugin, and never over a channel the plugin can forge.
   *
   * Every path ends in exactly one message back, because the host is holding
   * a two-second deadline open on the other end.
   *
   * @param {{id: number, kind: string, from: string, to: string}} message
   * @returns {Promise<void>}
   */
  async function request(message) {
    const handler = handlers.get(message.kind) ?? handlers.get(ALSO_KNOWN_AS.get(message.kind) ?? '')
    if (handler === undefined) {
      await send({ kind: 'failed', id: message.id, error: `nothing answers ${message.kind}` })
      return
    }
    try {
      const value = await handler(message)
      await send({ kind: 'reply', id: message.id, value: value ?? [] })
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      await send({ kind: 'failed', id: message.id, error: said })
    }
  }

  const global = /** @type {any} */ (window)
  global.planner = planner
  global.__planner = {
    request,
    /** Overwritten by the page with what `config.toml` holds, before the
     *  plugin's own entry is imported. Present here so the key exists even
     *  for a plugin the page never wrote one for. */
    settings: {},
    /**
     * The plugin's own code has run and its handlers are registered. Sent by
     * the page the host builds, after it imports the plugin's entry - never
     * by the plugin, which has no way of knowing it has finished loading.
     *
     * It carries what actually registered, so the host can say when a
     * manifest declares a slot nothing answers - which otherwise looks
     * exactly like a plugin that ignored the question (spec §1.1).
     * @returns {Promise<void>}
     */
    ready: () => send({ kind: 'ready', slots: [...handlers.keys()].sort() }),
  }
})()
