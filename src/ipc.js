// @ts-check

/**
 * The only module that talks to Rust (spec §11.6).
 *
 * Every mutation in the app goes: view -> core computes a new Document ->
 * here -> Rust writes the file atomically -> the watcher fires -> the app
 * re-reads that one page. Nothing in the UI writes a file, and nothing keeps
 * an in-memory copy that can drift from disk (spec §4.1).
 *
 * Everything imports this one module, so there is one place to look for
 * everything the frontend asks the shell for. It is three files underneath:
 * `ipc/host.js` is the contract and who serves it, `ipc/vault.js` is the
 * files, and `ipc/shell.js` is everything only an operating system can do.
 *
 * Without a Tauri host - opening `src/index.html` in a plain browser - the
 * calls are served by a sample vault instead, so the frontend can be
 * developed and looked at before the shell exists. The seam is exactly the
 * same either way; only the host changes.
 */

export { hasTauriHost } from './ipc/host.js'
export * from './ipc/vault.js'
export * from './ipc/shell.js'

/** @typedef {import('./ipc/host.js').Host} Host */
/** @typedef {import('./ipc/host.js').PageFile} PageFile */
/** @typedef {import('./ipc/host.js').Sidecar} Sidecar */
/** @typedef {import('./ipc/host.js').Alarm} Alarm */
/** @typedef {import('./ipc/host.js').Now} Now */
/** @typedef {import('./ipc/host.js').Answers} Answers */
/** @typedef {import('./ipc/host.js').VaultStatus} VaultStatus */
