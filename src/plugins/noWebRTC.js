// @ts-check

/**
 * No WebRTC in a plugin's webview (spec §0.2).
 *
 * This file is not loaded by the app. Like `runtime.js` it is baked into the
 * binary and injected into every frame of a plugin's window before anything
 * else runs.
 *
 * `connect-src 'none'` closes `fetch`, `XMLHttpRequest`, `sendBeacon` and
 * websockets, and governs no part of a peer connection: a TURN username or a
 * `stun:` hostname carries bytes to a server the plugin names, and the
 * request never passes a directive that could refuse it.
 *
 * Nothing here is a boundary on its own - it runs in the plugin's own webview
 * and a plugin can rewrite any line of it. It is a door pulled shut before
 * the plugin's code is let in the room.
 */

;(() => {
  const global = /** @type {any} */ (window)

  for (const name of [
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
    'RTCDataChannel',
    'RTCIceCandidate',
    'RTCSessionDescription',
  ]) {
    // Deleted first, because a `defineProperty` over an existing accessor on
    // the window prototype would not hide the accessor.
    try {
      delete global[name]
    } catch (error) {
      // Not configurable in this WebKit. The define below still shadows it.
    }
    try {
      Object.defineProperty(global, name, { value: undefined, writable: false, configurable: false })
    } catch (error) {
      // Nothing more this script can do from inside the plugin's own webview.
    }
  }
})()
