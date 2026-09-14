// @ts-check

/**
 * Every plugin folder on disk, as the ⌘, pane needs to see it.
 *
 * Its own file because it is the *pane's* view of the two files, where
 * `plan()` is the host's. The two ask the same questions of the same
 * manifests, and answer differently on purpose: `plan()` returns what may run,
 * and this returns everything there is to decide about, including the folders
 * that will never run at all.
 *
 * Nothing here throws and nothing here is a notice. A person opening the
 * settings pane is looking at what is installed, and a problem with one folder
 * is a line beside that folder rather than a page of complaints.
 */

import { readManifest, slotOptions, optionText, optionNames } from './manifest.js'
import { boxSize, SIDE } from './box.js'
import { settled, resolveOpen, personSet, valueOf, isApproved } from './pluginSettings.js'
import { isPluginName, BAD_NAME, both } from './plugins.js'
import { TOKEN_NAMES } from './theme.js'

/** @typedef {import('./config.js').PluginConfig} PluginConfig */
/** @typedef {import('./settingsSchema.js').SettingsField} SettingsField */
/** @typedef {import('./toml.js').TomlValue} TomlValue */
/** @typedef {import('./plugins.js').Folder} Folder */

/** A heading sits above a list in a narrow popover. Longer than this is a
 *  sentence, and a sentence is not a heading (spec §1.3). */
const HEADING = 40

/**
 * What a placeholder in a command will hold when it is run.
 *
 * `value` is null for a date - which is not known until the call - and for a
 * setting the person has not set, which is a call that will be refused. The
 * pane tells the two apart by the rule.
 *
 * @typedef {object} RunBinding
 * @property {string} name  the placeholder
 * @property {'date'|'setting'} rule
 * @property {string} key  the setting's name; `''` for a date
 * @property {string|null} value
 */

/**
 * @typedef {object} RunRow
 * @property {string} name
 * @property {string} line  the rendering, which is what the tick approves
 * @property {boolean} approved  whether config.toml holds exactly this line
 * @property {RunBinding[]} binds
 */

/**
 * A plugin as the settings pane needs to show it.
 *
 * @typedef {object} Installed
 * @property {string} name
 * @property {boolean} enabled
 * @property {string[]} slots  slots the manifest declares
 * @property {string[]} approvedSlots  of those, the ones config.toml allows
 * @property {string[]} asked  capabilities the manifest asks for
 * @property {string[]} approved  of those, the ones config.toml has allowed
 * @property {string[]} open  addresses the manifest declares
 * @property {string[]} approvedOpen  of those, the ones config.toml allows
 * @property {RunRow[]} run  commands the manifest declares, ticked or not
 * @property {Map<string, string>} approvedRun  the raw table, so writing one
 *   tick back does not throw away the others
 * @property {string[]} prefixes  the sidecar suffixes its manifest claims,
 *   before any other plugin's claim is taken into account. The pane shows what
 *   the manifest says; who actually owns one is settled by `settlePrefixes`
 * @property {string} heading  what the day page calls this plugin's section
 * @property {string} actionLabel  the gesture this plugin adds to a line, as
 *   the ⌘, pane names it. Its folder name when the manifest gives none
 * @property {{width: number, height: number}} box  how much of the day's
 *   margin its picture asks for, already held between the bounds the page can
 *   pay. Always a size, the way `heading` is always a word: a plugin that
 *   never draws one simply never has it read
 * @property {string[]} moves  the theme tokens this plugin says it moves, of
 *   the names this version knows. A name no theme has is dropped here rather
 *   than shown: the pane is a consent surface, and offering a tick over
 *   something that can never move anything is offering to approve nothing
 * @property {string[]} approvedMoves  of those, the ones config.toml allows
 * @property {string[]} notices  what its manifest reader had to leave out.
 *   The pane is where these can be acted on, and for a plugin that is not
 *   switched on it is the only place they are shown at all
 * @property {string|null} problem  why it cannot run, when it cannot
 * @property {SettingsField[]} schema  the settings the manifest declares
 * @property {Map<string, TomlValue>} held  what the person actually set, as
 *   `config.toml` holds it, and the only settings map the pane has.
 *
 *   The *settled* map - this one with the manifest's defaults filled in - is
 *   what a running plugin is handed, and it is built by `plan()` rather than
 *   carried here. It used to be both, and the pane wrote it back: the first
 *   tick on any row turned the author's default into the person's own value,
 *   after which `personSet` could no longer tell them apart, and a command the
 *   pane called unbindable ran on the same click (spec §3.2). One map on this
 *   record is what makes that mistake unavailable rather than merely warned
 *   against
 */

/**
 * @param {Folder[]} folders
 * @param {Map<string, PluginConfig>} configured
 * @returns {Installed[]}
 */
export function installed(folders, configured) {
  return folders.map((folder) => {
    const configEntry = configured.get(folder.name)
    const enabled = configEntry?.enabled === true
    const approvedRun = configEntry?.approvedRun ?? new Map()

    // Before the manifest is read: a folder that cannot be a plugin has not
    // earned a reading of anything else it says.
    if (!isPluginName(folder.name)) {
      return {
        name: folder.name,
        enabled,
        slots: [], approvedSlots: [], asked: [], approved: [], open: [], approvedOpen: [],
        run: [],
        approvedRun,
        prefixes: [],
        heading: folder.name,
        actionLabel: folder.name,
        box: { width: SIDE, height: SIDE },
        moves: [],
        approvedMoves: [],
        notices: [],
        problem: BAD_NAME,
        schema: [],
        held: configEntry?.settings ?? new Map(),
      }
    }

    const read = readManifest(folder.manifest)
    // Collected rather than discarded: every one of these lines was written
    // for a person to read, and the pane is where a person is.
    const notices = [...read.notices]
    const held = configEntry?.settings ?? new Map()
    const settings = settled(folder.name, read.settings, held, notices)
    // An unset settings-derived entry resolves to nothing, so it is simply
    // not offered rather than shown as the literal `settings.<key>` string.
    const open = resolveOpen(folder.name, read.open, settings, notices)
    const set = personSet(read.settings, held)
    // Filtered to what this version can actually move. An unknown name is
    // dropped by `claimed()` anyway, so showing it would put a token in the
    // consent sentence that no answer could ever use - and the notice a
    // plugin then gets for sending it says it may not move what the pane
    // says it declared.
    const moves = optionNames(slotOptions(read, 'theme.tokens'), 'moves')
      .filter((name) => TOKEN_NAMES.includes(name))

    return {
      name: folder.name,
      enabled,
      slots: read.slots,
      approvedSlots: both(read.slots, configEntry?.approvedSlots),
      asked: read.capabilities,
      approved: both(read.capabilities, configEntry?.approvedCapabilities),
      open,
      approvedOpen: both(open, configEntry?.approvedOpen),
      run: read.run.map((command) => ({
        name: command.name,
        line: command.line,
        approved: isApproved(command, approvedRun),
        binds: command.binds.map((bind) => ({
          name: bind.name,
          rule: bind.rule,
          key: bind.key,
          // What will be on the command line, so the tick is a decision about
          // a real command rather than about a template.
          value: bind.rule === 'setting' ? valueOf(set.get(bind.key)) : null,
        })),
      })),
      approvedRun,
      prefixes: read.prefixes,
      // The manifest's, when it has one. A plugin that never contributes
      // never has this drawn - and a null would only mean every reader had to
      // check for one.
      heading: optionText(slotOptions(read, 'vault.contribute'), 'heading', HEADING) || folder.name,
      // The gesture this plugin adds to a line, as the pane names it. Spec
      // §4.3 puts this in the manifest for a pick list, which this version
      // does not draw; the pane is its consumer instead, so the sentence you
      // tick says which gesture rather than naming none.
      actionLabel: optionText(slotOptions(read, 'item.action'), 'label', HEADING) || folder.name,
      // Read here rather than where the margin is drawn, so the pane and the
      // day page agree about how big a plugin's picture is without the view
      // having to parse a manifest on its draw path.
      box: boxSize(read),
      moves,
      approvedMoves: both(moves, configEntry?.approvedMoves),
      notices,
      problem: read.error,
      schema: read.settings,
      held,
    }
  })
}
