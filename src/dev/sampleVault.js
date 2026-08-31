// @ts-check

/**
 * A vault in memory, for looking at the frontend without the Tauri shell.
 *
 * Development only. `ipc.js` falls back to this when no Tauri host is
 * present, which is what makes `npm run serve` plus a browser a working way
 * to build views before - and after - the Rust side exists.
 *
 * It behaves like the real host in the one way that matters: a write does not
 * update anything directly. It stores the text and then fires the change
 * handler, exactly as the filesystem watcher does, so the app is exercising
 * the real data flow rather than a shortcut around it (spec §4.1).
 */

import { addDays } from '../core/dates.js'
import { today as todayHere } from '../clock.js'

/** @typedef {import('../ipc.js').Host} Host */
/** @typedef {import('../ipc.js').PageFile} PageFile */

/** @returns {Host} */
export function sampleHost() {
  const today = todayHere()
  const pages = samplePages(today)
  /** @type {((page: string) => void)[]} */
  const handlers = []

  return {
    readConfig: async () => 'vault = "~/Planner"\ntheme = "ledger"\n',
    // No theme folder here: the app falls back to the built-in Ledger tokens.
    readTheme: async () => ({ toml: '', css: '' }),
    readVault: async () => [...pages].map(([page, text]) => ({ page, text })),
    readPage: async (page) => pages.get(page) ?? null,
    writePage: async (page, text) => {
      pages.set(page, text)
      // Announce it the way the watcher would, on a later turn of the loop.
      queueMicrotask(() => { for (const handler of handlers) handler(page) })
    },
    onVaultChanged: (handler) => { handlers.push(handler) },
  }
}

/**
 * @param {string} today `YYYY-MM-DD`
 * @returns {Map<string, string>}
 */
function samplePages(today) {
  const soon = addDays(today, 2)
  const later = addDays(today, 5)
  const yesterday = addDays(today, -1)

  return new Map([
    [today, [
      `# ${today}`,
      '',
      '- [x] Standup — flag the merchant sync bug',
      '- [ ] Pair with Dana on the offline queue @10:30',
      '- [ ] Review PR #4412 — printer retry',
      '  > ask about the 30s timeout',
      `- [ ] Firmware sign-off — start the checklist !${soon} ~10d`,
      '- [ ] Order the Pi Zero + the GPIO hat',
      '- [ ] Java, chapter 6 exercises',
      '',
      '---',
      '',
      'Shipped the retry fix. The offline queue finally makes sense.',
      '',
    ].join('\n')],

    [yesterday, [
      `# ${yesterday}`,
      '',
      '- [x] Merchant sync postmortem',
      '- [ ] Reply to the vendor survey',
      `- [ ] Payout reconciliation !${later}`,
      '',
    ].join('\n')],

    ['someday', [
      '# Someday',
      '',
      '- [ ] Rebuild the deck railing',
      '- [ ] Read the Postgres internals book',
      '- [ ] Find a decent bench multimeter',
      '',
    ].join('\n')],
  ])
}
