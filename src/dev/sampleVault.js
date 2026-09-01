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
    // ?theme=console picks a bundled theme, so the three can be compared
    // without editing a config file.
    readConfig: async () => {
      const chosen = new URLSearchParams(location.search).get('theme') ?? 'ledger'
      return { text: `vault = "~/Planner"\ntheme = "${chosen}"\n`, home: '/home/sample' }
    },

    // Nothing to write and nowhere to browse: the pages below are the
    // vault, and a browser has no folder picker to offer.
    writeConfig: async () => {},
    chooseVault: async () => null,

    // Nothing to open: the pages below are the vault.
    setVault: async () => ({ exists: true, watching: 'events' }),

    // A browser has no menu bar item and no window to put away. The badge is
    // put in the tab title instead, which is the nearest thing a browser has
    // to an icon that says something before you look at it.
    setHotkey: async () => {},
    closeQuickAdd: async () => {},
    setPinned: async () => {},
    setBadge: async (text) => { document.title = text === null ? 'Planner' : `${text} · Planner` },
    // No shell to hold timers, and a browser tab is not where a
    // notification belongs. The schedule is computed and thrown away.
    setNotifications: async () => {},
    onScheduleRefresh: () => {},
    closePopover: async () => {},
    // A browser has tabs of its own: the window opens as a page, in a page.
    openSpread: async (view) => { location.href = `./spread.html?view=${view}` },
    spreadView: async () => new URLSearchParams(location.search).get('view'),
    onSpreadView: () => {},
    // The bundled themes, served as files - so the browser exercises the real
    // theme path, not a shortcut past it. A theme that is not there falls back
    // to the built-in Ledger tokens.
    readTheme: async (name) => ({
      toml: await fetchOrEmpty(`/themes/${name}/theme.toml`),
      css: await fetchOrEmpty(`/themes/${name}/theme.css`),
    }),
    readVault: async () => [...pages].map(([page, text]) => ({ page, text })),
    readPage: async (page) => pages.get(page) ?? null,
    // No files, so nothing to name and nothing to open.
    pagePath: async () => null,
    openInEditor: async () => {},
    writePage: async (page, text) => {
      pages.set(page, text)
      // Announce it the way the watcher would, on a later turn of the loop.
      queueMicrotask(() => { for (const handler of handlers) handler(page) })
    },
    onVaultChanged: (handler) => { handlers.push(handler) },

    // No plugin host in a browser: nothing to install, nothing to start.
    listPlugins: async () => [],

    // A browser tab is never opened from a menu bar icon.
    onPopoverShown: () => {},
    startPlugin: async () => {},

    // Stood in for, rather than left empty, so the section under the list can
    // be looked at without a calendar or a Tauri shell.
    contribute: async (from) => ({
      items: [
        { date: from, time: '09:30', text: 'Standup' },
        { date: from, time: '14:00', text: '1:1 with Priya' },
      ],
      notices: [],
    }),
  }
}

/**
 * @param {string} path
 * @returns {Promise<string>} empty when the file is not there
 */
async function fetchOrEmpty(path) {
  const response = await fetch(path)
  return response.ok ? response.text() : ''
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
