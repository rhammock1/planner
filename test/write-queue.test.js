// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { serialize } from '../src/core/serialize.js'
import { setItemState, appendItem } from '../src/core/edit.js'
import { createItem } from '../src/core/model.js'
import { createWriteQueue } from '../src/writeQueue.js'

/** @typedef {import('../src/core/model.js').Document} Document */

const DAY = '# 2026-08-31\n\n- [ ] One\n- [ ] Two\n'

/**
 * A host that writes into a Map, and only reports pages as read back when
 * `deliver` is called - which is the window this queue exists to cover.
 */
function fakeHost() {
  /** @type {Map<string, string>} */
  const disk = new Map([['2026-08-31', DAY], ['2026-09-01', '# 2026-09-01\n\n- [ ] Other\n']])
  /** @type {string[]} */
  const writes = []
  /** @type {Map<string, string>} */
  const pending = new Map()

  return {
    disk,
    writes,
    /** @type {(page: string, doc: Document) => Promise<void>} */
    write: async (page, doc) => {
      writes.push(page)
      pending.set(page, serialize(doc))
    },
    /** Everything written so far becomes visible on disk. */
    deliver: () => {
      for (const [page, text] of pending) disk.set(page, text)
      pending.clear()
    },
    /** @type {(page: string) => Document|null} */
    read: (page) => {
      const text = disk.get(page)
      return text === undefined ? null : parse(text)
    },
  }
}

describe('changes that overlap', () => {
  // Two clicks inside one round trip. Without the queue both read the page as
  // it was, and the second write discards the first.
  test('a second change sees the first, even before it lands', async () => {
    const host = fakeHost()
    const queue = createWriteQueue(host.write)
    const read = () => host.read('2026-08-31')

    const first = queue.change('2026-08-31', read, (doc) => setItemState(/** @type {Document} */ (doc), 1, 'done'))
    const second = queue.change('2026-08-31', read, (doc) => setItemState(/** @type {Document} */ (doc), 2, 'done'))
    assert.deepEqual(await Promise.all([first, second]), [true, true])

    host.deliver()
    assert.equal(host.disk.get('2026-08-31'), '# 2026-08-31\n\n- [x] One\n- [x] Two\n')
  })

  test('toggling the same line twice ends where it started', async () => {
    const host = fakeHost()
    const queue = createWriteQueue(host.write)
    const read = () => host.read('2026-08-31')

    const flip = () => queue.change('2026-08-31', read, (doc) => {
      const node = /** @type {Document} */ (doc).nodes[1]
      if (node === undefined || node.kind !== 'item') return null
      return setItemState(/** @type {Document} */ (doc), 1, node.state === 'done' ? 'open' : 'done')
    })

    await Promise.all([flip(), flip()])
    host.deliver()
    assert.equal(host.disk.get('2026-08-31'), DAY)
  })

  test('two pages in flight do not overwrite each other', async () => {
    const host = fakeHost()
    const queue = createWriteQueue(host.write)

    await Promise.all([
      queue.change('2026-08-31', () => host.read('2026-08-31'), (doc) => setItemState(/** @type {Document} */ (doc), 1, 'done')),
      queue.change('2026-09-01', () => host.read('2026-09-01'), (doc) => setItemState(/** @type {Document} */ (doc), 1, 'done')),
    ])

    host.deliver()
    assert.match(host.disk.get('2026-08-31') ?? '', /- \[x\] One/)
    assert.match(host.disk.get('2026-09-01') ?? '', /- \[x\] Other/)
  })

  test('changes are written one at a time, in order', async () => {
    const host = fakeHost()
    const queue = createWriteQueue(host.write)
    const read = () => host.read('2026-08-31')

    const add = (/** @type {string} */ text) => queue.change(
      '2026-08-31', read, (doc) => appendItem(/** @type {Document} */ (doc), createItem(text)),
    )
    await Promise.all([add('First'), add('Second'), add('Third')])

    host.deliver()
    assert.equal(
      host.disk.get('2026-08-31'),
      '# 2026-08-31\n\n- [ ] One\n- [ ] Two\n- [ ] First\n- [ ] Second\n- [ ] Third\n',
    )
  })
})

describe('once a page has been read back', () => {
  test('the next change starts from what is on disk', async () => {
    const host = fakeHost()
    const queue = createWriteQueue(host.write)
    const read = () => host.read('2026-08-31')

    await queue.change('2026-08-31', read, (doc) => setItemState(/** @type {Document} */ (doc), 1, 'done'))
    host.deliver()
    queue.observed('2026-08-31')

    // An edit that arrived from somewhere else - nvim, say - while we waited.
    host.disk.set('2026-08-31', '# 2026-08-31\n\n- [x] One\n- [ ] Two\n- [ ] Added elsewhere\n')

    await queue.change('2026-08-31', read, (doc) => setItemState(/** @type {Document} */ (doc), 2, 'done'))
    host.deliver()
    assert.match(host.disk.get('2026-08-31') ?? '', /Added elsewhere/)
    assert.match(host.disk.get('2026-08-31') ?? '', /- \[x\] Two/)
  })
})

describe('a write that fails', () => {
  test('is reported, and the document that never landed is forgotten', async () => {
    const host = fakeHost()
    let failing = true
    const queue = createWriteQueue(async (page, doc) => {
      if (failing) throw new Error('disk full')
      await host.write(page, doc)
    })
    const read = () => host.read('2026-08-31')

    await assert.rejects(
      queue.change('2026-08-31', read, (doc) => setItemState(/** @type {Document} */ (doc), 1, 'done')),
      /disk full/,
    )

    // The next change must start from the file, not from the write that failed.
    failing = false
    await queue.change('2026-08-31', read, (doc) => setItemState(/** @type {Document} */ (doc), 2, 'done'))
    host.deliver()
    assert.equal(host.disk.get('2026-08-31'), '# 2026-08-31\n\n- [ ] One\n- [x] Two\n')
  })

  test('does not stop what comes after it', async () => {
    const host = fakeHost()
    let attempt = 0
    const queue = createWriteQueue(async (page, doc) => {
      attempt += 1
      if (attempt === 1) throw new Error('disk full')
      await host.write(page, doc)
    })
    const read = () => host.read('2026-08-31')

    const first = queue.change('2026-08-31', read, (doc) => setItemState(/** @type {Document} */ (doc), 1, 'done'))
    const second = queue.change('2026-08-31', read, (doc) => setItemState(/** @type {Document} */ (doc), 2, 'done'))

    await assert.rejects(first)
    assert.equal(await second, true)
  })
})

describe('a change that decides against writing', () => {
  test('writes nothing and reports it', async () => {
    const host = fakeHost()
    const queue = createWriteQueue(host.write)
    assert.equal(await queue.change('2026-08-31', () => host.read('2026-08-31'), () => null), false)
    assert.deepEqual(host.writes, [])
  })
})
