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
     * Supply items for a range of days. The one slot in v1.
     * @param {(range: {from: string, to: string}) => unknown} handler
     */
    onContribute(handler) {
      handlers.set('contribute', handler)
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
    const handler = handlers.get(message.kind)
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
    /**
     * The plugin's own code has run and its handlers are registered. Sent by
     * the page the host builds, after it imports the plugin's entry - never
     * by the plugin, which has no way of knowing it has finished loading.
     * @returns {Promise<void>}
     */
    ready: () => send({ kind: 'ready' }),
  }
})()
