// @ts-check

/**
 * A command a plugin may run, as the settings pane asks about it (spec §3.2).
 *
 * Split out of `pluginRows.js`, which was over this project's 300-line limit
 * with it: a command is the one thing in the pane that is approved by a
 * *string* rather than by a name, and it brings a rendering, a Copy button and
 * a line per placeholder with it.
 */

import { el } from '../ui/dom.js'
import { tick } from './tick.js'

/** @typedef {import('../core/installed.js').Installed} Installed */
/** @typedef {import('./settingsPanel.js').SettingsHandlers} SettingsHandlers */

/**
 * One command, its tick, and what its holes will hold.
 *
 * The tick is beside the *line*, because the line is what is being approved:
 * a manifest that changes an argument renders differently and arrives here
 * unticked. The bindings are underneath because a template is not a decision -
 * `git -C {repo=settings.repo} log` says where the value comes from but not
 * what it is, and it is only worth ticking once you can see which repository
 * it will be pointed at.
 *
 * @param {Installed} plugin
 * @param {import('../core/installed.js').RunRow} command
 * @param {SettingsHandlers} handlers
 * @returns {HTMLElement}
 */
export function commandRow(plugin, command, handlers) {
  const block = el('div', 'plugin-command')

  const line = el('div', 'command-line')
  line.append(tick(
    command.line,
    command.approved,
    'command',
    // An empty line rather than a missing key: `tomlEdit` cannot delete one,
    // and an empty string is never equal to a rendered command, so what is
    // left behind reads as exactly what it means (spec §1.6).
    (on) => handlers.onPlugin(plugin.name, {
      enabled: plugin.enabled,
      approvedSlots: plugin.approvedSlots,
      approvedCapabilities: plugin.approved,
      approvedOpen: plugin.approvedOpen,
      approvedRun: new Map([...plugin.approvedRun, [command.name, on ? command.line : '']]),
      settings: plugin.settings,
    }),
  ), copyButton(command.line))
  block.append(line)

  for (const bind of command.binds) {
    block.append(el('div', 'plugin-bind', `{${bind.name}} is ${saying(bind)}`))
  }
  return block
}

/**
 * What a placeholder will hold when the command runs.
 *
 * A setting nobody has set says so, and says what happens next, because the
 * alternative is a ticked command that is refused every time with the reason
 * only in a notice (spec §3.2).
 *
 * @param {import('../core/installed.js').RunBinding} bind
 * @returns {string}
 */
function saying(bind) {
  if (bind.rule === 'date') return 'the day being asked about'
  if (bind.value === null) return `the ${bind.key} setting, which is not set — this command will be refused`
  return bind.value
}

/**
 * Hands the line over, so approving by hand is pasting rather than retyping.
 *
 * A button rather than something inside the label: a click inside a `<label>`
 * toggles its checkbox, and copying a line is not approving it.
 *
 * @param {string} line
 * @returns {HTMLElement}
 */
function copyButton(line) {
  const button = el('button', 'command-copy', 'Copy')
  button.setAttribute('type', 'button')
  button.title = 'Copy this line, to paste into config.toml'
  button.addEventListener('click', () => {
    void navigator.clipboard.writeText(line).then(
      () => { button.textContent = 'Copied' },
      // Said on the button rather than as a page notice: it is the button
      // that did not work, and nothing else about the plugin is affected.
      () => { button.textContent = 'Could not copy' },
    )
  })
  return button
}
