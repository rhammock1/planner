// @ts-check
// This reference is program-wide, not file-scoped - see the same note in
// `test/sidecar-store.test.js`.
/// <reference types="node" />

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isMarkdownPath, nameOf, folderOf, titleOf, insideVault } from '../src/core/files.js'
import { shortenHome, expandHome } from '../src/core/config.js'

describe('what counts as a file this app will open', () => {
  test('a .md file does, whatever case it is written in', () => {
    assert.equal(isMarkdownPath('/Users/x/Planner/notes.md'), true)
    assert.equal(isMarkdownPath('/Users/x/Planner/NOTES.MD'), true)
  })

  test('nothing else does', () => {
    assert.equal(isMarkdownPath('/Users/x/Planner/notes.txt'), false)
    assert.equal(isMarkdownPath('/Users/x/Planner/notes.markdown'), false)
    assert.equal(isMarkdownPath('/Users/x/Planner/md'), false)
    assert.equal(isMarkdownPath(''), false)
  })
})

describe('the parts of a path', () => {
  test('the last segment is the name, and the rest is the folder', () => {
    assert.equal(nameOf('/Users/x/Planner/notes.md'), 'notes.md')
    assert.equal(folderOf('/Users/x/Planner/notes.md'), '/Users/x/Planner')
  })

  test('a file at the root keeps the root as its folder', () => {
    assert.equal(folderOf('/notes.md'), '/')
  })
})

describe('what the window calls a file', () => {
  test('its first heading, when it has one', () => {
    assert.equal(titleOf('# A Rumbling of Thunder\n\n## Session 0\n', '/x/a.md'), 'A Rumbling of Thunder')
  })

  test('a heading further down still counts - the first one is the title', () => {
    assert.equal(titleOf('some prose\n\n# Later\n', '/x/a.md'), 'Later')
  })

  // `##` is not `# `, and a file that opens on a sub-heading has no title of
  // its own to take.
  test('a deeper heading is not a title', () => {
    assert.equal(titleOf('## Session 0\n', '/x/campaign.md'), 'campaign')
  })

  test('no heading falls back to the filename without its extension', () => {
    assert.equal(titleOf('just prose\n', '/x/A-RUMBLING-OF-THUNDER.md'), 'A-RUMBLING-OF-THUNDER')
  })

  test('an empty heading is not a name, so the filename wins', () => {
    assert.equal(titleOf('# \n', '/x/campaign.md'), 'campaign')
  })
})

describe('whether the watcher will see it', () => {
  test('a file in the vault is in the vault', () => {
    assert.equal(insideVault('/Users/x/Planner/a.md', '/Users/x/Planner'), true)
    assert.equal(insideVault('/Users/x/Planner/2026/09/a.md', '/Users/x/Planner'), true)
  })

  // The trap this function exists for: a string prefix is not a folder.
  test('a folder that merely starts with the same letters is not', () => {
    assert.equal(insideVault('/Users/x/Planner-old/a.md', '/Users/x/Planner'), false)
  })

  test('somewhere else entirely is not', () => {
    assert.equal(insideVault('/Users/x/gotab/notes.md', '/Users/x/Planner'), false)
  })

  test('no vault means nothing is in it', () => {
    assert.equal(insideVault('/Users/x/a.md', ''), false)
  })
})

describe('a path as a person writes it', () => {
  test('home becomes a tilde, and comes back', () => {
    assert.equal(shortenHome('/Users/x/Planner/a.md', '/Users/x'), '~/Planner/a.md')
    assert.equal(expandHome('~/Planner/a.md', '/Users/x'), '/Users/x/Planner/a.md')
  })

  test('home itself is a tilde on its own', () => {
    assert.equal(shortenHome('/Users/x', '/Users/x'), '~')
  })

  // The same prefix trap as `insideVault`, and the reason this is not one line.
  test('a sibling of home keeps its path', () => {
    assert.equal(shortenHome('/Users/xavier/a.md', '/Users/x'), '/Users/xavier/a.md')
  })

  test('nothing to resolve against leaves the path alone', () => {
    assert.equal(shortenHome('/Users/x/a.md', ''), '/Users/x/a.md')
  })
})
