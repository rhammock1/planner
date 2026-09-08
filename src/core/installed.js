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

import { readManifest, slotOptions, optionText } from './manifest.js'
import { settled, resolveOpen, personSet, valueOf } from './pluginSettings.js'
import { isPluginName, BAD_NAME, both } from './plugins.js'

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
 * @property {string} heading  what the day page calls this plugin's section
 * @property {string|null} problem  why it cannot run, when it cannot
 * @property {SettingsField[]} schema  the settings the manifest declares
 * @property {Map<string, TomlValue>} settings  the settled values
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
        heading: folder.name,
        problem: BAD_NAME,
        schema: [],
        settings: new Map(),
      }
    }

    const read = readManifest(folder.manifest)
    const settings = settled(folder.name, read.settings, configEntry?.settings ?? new Map(), [])
    // An unset settings-derived entry resolves to nothing, so it is simply
    // not offered rather than shown as the literal `settings.<key>` string.
    const open = resolveOpen(folder.name, read.open, settings, [])
    const set = personSet(read.settings, configEntry?.settings ?? new Map())

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
        approved: approvedRun.get(command.name) === command.line,
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
      // The manifest's, when it has one. A plugin that never contributes
      // never has this drawn - and a null would only mean every reader had to
      // check for one.
      heading: optionText(slotOptions(read, 'vault.contribute'), 'heading', HEADING) || folder.name,
      problem: read.error,
      schema: read.settings,
      settings,
    }
  })
}
