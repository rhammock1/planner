// @ts-check

/**
 * One row per setting the pane shows, in the order it shows them.
 *
 * A table rather than markup, so a setting added to `core/config.js` needs one
 * line here and nothing else - the same reason the config reader is a table.
 */

/** @typedef {import('../core/config.js').Config} Config */

/**
 * @typedef {object} Field
 * @property {keyof Omit<Config, 'plugins'>} name
 * @property {string} label
 * @property {'text'|'days'|'switch'|'path'} kind
 * @property {string} [hint]  placeholder, for a setting whose empty value means something
 */

/** @type {Field[]} */
export const FIELDS = [
  { name: 'vault', label: 'Vault folder', kind: 'path' },
  { name: 'theme', label: 'Theme', kind: 'text' },
  { name: 'hotkey', label: 'Quick add shortcut', kind: 'text' },
  { name: 'horizonLeadDays', label: 'Deadlines appear this many days ahead', kind: 'days' },
  { name: 'carryForwardScanDays', label: 'Carry forward from this many days back', kind: 'days' },
  { name: 'menuBarCount', label: 'Count on the menu bar icon', kind: 'switch' },
  { name: 'menuBarHorizonDot', label: 'Dot when a deadline is near', kind: 'switch' },
  { name: 'editor', label: 'Editor command', kind: 'text', hint: '$VISUAL, $EDITOR, then open' },
]
