// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'
import { serialize, serializeItem } from '../src/core/serialize.js'
import { createItem } from '../src/core/model.js'
import { setItemText, carriesNothingElse, appendItem } from '../src/core/edit.js'
import { SOMEDAY, buildIndex, getPage, idIndex } from '../src/core/vaultIndex.js'
import { ID, isValidId, mintId, lineWithId, stamp, stampAll } from '../src/core/ids.js'
import { unfinished, carryForward } from '../src/core/carry.js'
import { moveItem } from '../src/core/move.js'

/**
 * @param {Record<string, string>} pages page key -> file text
 * @returns {import('../src/core/vaultIndex.js').VaultIndex}
 */
function vault(pages) {
  return buildIndex(Object.entries(pages).map(([page, text]) => ({ page, doc: parse(text) })))
}

/**
 * The lines of a page that hold an id, as `state:id` pairs in file order.
 *
 * @param {import('../src/core/model.js').Document|null} doc
 * @returns {string[]}
 */
function named(doc) {
  if (doc === null) return []
  return doc.nodes.flatMap((node) =>
    (node.kind === 'item' && node.id !== null ? [`${node.state}:${node.id}`] : []))
}

/**
 * A `random` that walks a list and then repeats its last value forever, so a
 * test can say exactly which ids get drawn.
 *
 * @param {string[]} ids
 * @returns {() => number}
 */
function drawing(ids) {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789'
  /** @type {number[]} */
  const numbers = []
  for (const id of ids) {
    for (const char of id) numbers.push(letters.indexOf(char) / letters.length)
  }
  let at = 0
  return () => numbers[Math.min(at++, numbers.length - 1)] ?? 0
}

describe('the token in a file', () => {
  test('a name is read off the line and kept out of the words', () => {
    const doc = parse('# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n')
    const item = doc.nodes[1]
    assert.equal(item?.kind, 'item')
    assert.equal(item.kind === 'item' && item.id, 'k4m2qa')
    assert.equal(item.kind === 'item' && item.text, 'Firmware sign-off')
  })

  test('a named line round-trips byte for byte', () => {
    const text = '# 2026-09-01\n\n- [ ] Firmware sign-off @09:30 !2026-09-02 ~10d ^k4m2qa\n'
    assert.equal(serialize(parse(text)), text)
  })

  test('the name is written last, after every other token', () => {
    const item = createItem('Order the Pi Zero', {
      state: 'migrated', time: '09:30', due: '2026-09-02', lead: 10,
      movedTo: '2026-09-01', id: 'k4m2qa',
    })
    assert.equal(
      serializeItem(item),
      '- [>] Order the Pi Zero @09:30 !2026-09-02 ~10d >2026-09-01 ^k4m2qa',
    )
  })

  test('a line with no name is written without one', () => {
    assert.equal(serializeItem(createItem('Water the plants')), '- [ ] Water the plants')
  })

  test('a name read from anywhere on the line is written back at the end', () => {
    const doc = parse('# 2026-09-01\n\n- [ ] ^k4m2qa Firmware sign-off !2026-09-02\n')
    assert.equal(serialize(doc), '# 2026-09-01\n\n- [ ] Firmware sign-off !2026-09-02 ^k4m2qa\n')
  })

  test('a caret that is not a name stays prose', () => {
    for (const written of ['x^k4m2qa', '^K4M2QA', '^k4m2q', '^k4m2qaa', '^k4m-qa', '^']) {
      const doc = parse(`# 2026-09-01\n\n- [ ] Read ${written} now\n`)
      const item = doc.nodes[1]
      assert.equal(item?.kind === 'item' && item.id, null, `${written} should not be a name`)
      assert.equal(item?.kind === 'item' && item.text, `Read ${written} now`)
    }
  })

  test('the words survive an edit with the name attached', () => {
    const doc = parse('# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n')
    const edited = setItemText(doc, 1, 'Firmware sign-off — with Dana')
    assert.equal(
      serialize(edited),
      '# 2026-09-01\n\n- [ ] Firmware sign-off — with Dana ^k4m2qa\n',
    )
  })

  test('a name alone does not keep an emptied line alive', () => {
    // Deliberate: `carriesNothingElse` asks whether the user wrote anything
    // besides the sentence, and a name is the app's bookkeeping rather than
    // something the user wrote. A card whose line is gone is drawn unmatched
    // and never archived on its own, so nothing is lost by letting the line go.
    assert.equal(carriesNothingElse(createItem('', { id: 'k4m2qa' })), true)
    assert.equal(carriesNothingElse(createItem('', { note: 'ask Dana' })), false)
  })
})

describe('minting a name', () => {
  test('a fresh name is six lowercase letters and digits', () => {
    for (let n = 0; n < 200; n += 1) assert.match(mintId(new Set()), ID)
  })

  test('a name already in use is not handed out twice', () => {
    const taken = new Set(['aaaaaa'])
    assert.equal(mintId(taken, drawing(['aaaaaa', 'bbbbbb'])), 'bbbbbb')
  })

  test('a random that cannot find an unused name says so rather than hanging', () => {
    assert.throws(
      () => mintId(new Set(['aaaaaa']), () => 0),
      /could not find an unused id/,
    )
  })

  test('what is minted is a valid name and a near-miss is not', () => {
    assert.equal(isValidId('k4m2qa'), true)
    for (const no of ['K4M2QA', 'k4m2q', 'k4m2qaa', '^k4m2qa', '', 6]) {
      assert.equal(isValidId(no), false, `${String(no)} should not be a name`)
    }
  })
})

describe('looking a name up', () => {
  test('a name finds its line, and an unknown name finds nothing', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })
    const found = lineWithId(index, 'k4m2qa')
    assert.equal(found?.page, '2026-09-01')
    assert.equal(found?.index, 1)
    assert.equal(found?.item.text, 'Firmware sign-off')
    assert.equal(lineWithId(index, 'zzzzzz'), null)
  })

  test('a line found migrated is reported as it is, not read as done', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [>] Firmware sign-off >2026-09-02 ^k4m2qa\n',
    })
    assert.equal(lineWithId(index, 'k4m2qa')?.item.state, 'migrated')
  })

  test('the latest day wins when two lines hold one name', () => {
    // How a user makes one: the line was yanked and put into a later day in an
    // editor, so both files hold it. Nothing here is corrupt.
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
      '2026-09-03': '# 2026-09-03\n\n- [x] Firmware sign-off ^k4m2qa\n',
    })
    const found = lineWithId(index, 'k4m2qa')
    assert.equal(found?.page, '2026-09-03')
    assert.equal(found?.item.state, 'done')
  })

  test('a restored file does not throw and does not win', () => {
    // The old day came back from a backup holding a name that has since moved
    // on. The live line is still the answer.
    const index = vault({
      '2026-08-20': '# 2026-08-20\n\n- [ ] Firmware sign-off ^k4m2qa\n',
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })
    assert.equal(lineWithId(index, 'k4m2qa')?.page, '2026-09-01')
  })

  test('the back page beats a day, because that is where the line went', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
      [SOMEDAY]: '# Someday\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })
    assert.equal(lineWithId(index, 'k4m2qa')?.page, SOMEDAY)
  })

  test('one walk answers for every name in the vault', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] One ^aaaaaa\n- [ ] Two\n- [ ] Three ^bbbbbb\n',
      '2026-09-02': '# 2026-09-02\n\n- [ ] Four ^cccccc\n',
    })
    assert.deepEqual([...idIndex(index).keys()].sort(), ['aaaaaa', 'bbbbbb', 'cccccc'])
  })
})

describe('stamping a line', () => {
  test('a line with no name gets one, and the page to write with it', () => {
    const index = vault({ '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off\n' })
    const { id, write } = stamp(index, '2026-09-01', 1, drawing(['k4m2qa']))
    assert.equal(id, 'k4m2qa')
    assert.equal(write?.page, '2026-09-01')
    assert.equal(serialize(write?.doc ?? parse('')), '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n')
  })

  test('the vault it was handed is left exactly as it was', () => {
    const index = vault({ '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off\n' })
    const before = serialize(getPage(index, '2026-09-01') ?? parse(''))
    stamp(index, '2026-09-01', 1, drawing(['k4m2qa']))
    assert.equal(serialize(getPage(index, '2026-09-01') ?? parse('')), before)
  })

  test('a line that already has a name is not written again', () => {
    const index = vault({ '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n' })
    assert.deepEqual(stamp(index, '2026-09-01', 1), { id: 'k4m2qa', write: null })
  })

  test('a fresh name avoids every name the vault is already using', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Taken ^aaaaaa\n- [ ] Fresh\n',
    })
    const { id } = stamp(index, '2026-09-01', 2, drawing(['aaaaaa', 'bbbbbb']))
    assert.equal(id, 'bbbbbb')
  })

  test('a line that is not there is refused rather than guessed at', () => {
    const index = vault({ '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off\n' })
    assert.throws(() => stamp(index, '2026-09-01', 0), /is not an item/)
    assert.throws(() => stamp(index, '2026-09-01', 9), /is not an item/)
    assert.throws(() => stamp(index, '2026-09-09', 1), /is not an item/)
  })

  test('two lines named at once never draw the same name', () => {
    // A random that offers `aaaaaa` twice: the second line has to notice that
    // the first took it, in a vault neither write has landed in.
    const index = vault({ '2026-09-01': '# 2026-09-01\n\n- [ ] One\n- [ ] Two\n' })
    const { ids } = stampAll(
      index,
      [{ page: '2026-09-01', at: 1 }, { page: '2026-09-01', at: 2 }],
      drawing(['aaaaaa', 'aaaaaa', 'bbbbbb']),
    )
    assert.deepEqual(ids, ['aaaaaa', 'bbbbbb'])
  })

  test('two lines on one page come back as one write holding both names', () => {
    const index = vault({ '2026-09-01': '# 2026-09-01\n\n- [ ] One\n- [ ] Two\n' })
    const { writes } = stampAll(
      index,
      [{ page: '2026-09-01', at: 1 }, { page: '2026-09-01', at: 2 }],
      drawing(['aaaaaa', 'bbbbbb']),
    )
    assert.equal(writes.length, 1)
    assert.equal(
      serialize(writes[0]?.doc ?? parse('')),
      '# 2026-09-01\n\n- [ ] One ^aaaaaa\n- [ ] Two ^bbbbbb\n',
    )
  })

  test('lines on two pages come back as one write each', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] One\n',
      '2026-09-02': '# 2026-09-02\n\n- [ ] Two\n',
    })
    const { ids, writes } = stampAll(
      index,
      [{ page: '2026-09-01', at: 1 }, { page: '2026-09-02', at: 1 }],
      drawing(['aaaaaa', 'bbbbbb']),
    )
    assert.deepEqual(ids, ['aaaaaa', 'bbbbbb'])
    assert.deepEqual(writes.map((write) => write.page), ['2026-09-01', '2026-09-02'])
  })

  test('a list of lines that all have names already writes nothing', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] One ^aaaaaa\n- [ ] Two ^bbbbbb\n',
    })
    const { ids, writes } = stampAll(
      index,
      [{ page: '2026-09-01', at: 1 }, { page: '2026-09-01', at: 2 }],
    )
    assert.deepEqual(ids, ['aaaaaa', 'bbbbbb'])
    assert.deepEqual(writes, [])
  })

  test('the same line twice in one list is named once', () => {
    const index = vault({ '2026-09-01': '# 2026-09-01\n\n- [ ] One\n' })
    const { ids, writes } = stampAll(
      index,
      [{ page: '2026-09-01', at: 1 }, { page: '2026-09-01', at: 1 }],
      drawing(['aaaaaa', 'bbbbbb']),
    )
    assert.deepEqual(ids, ['aaaaaa', 'aaaaaa'])
    assert.equal(writes.length, 1)
  })

  test('nothing else in core mints one', () => {
    // The whole point of the lazy rule: reading a vault, appending to it and
    // serialising it leave every line as anonymous as it was found.
    const index = vault({ '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off\n' })
    const doc = getPage(index, '2026-09-01') ?? parse('')
    const grown = appendItem(doc, createItem('Water the plants'))
    assert.equal(idIndex(index).size, 0)
    assert.equal(named(grown).length, 0)
    assert.equal(serialize(grown), '# 2026-09-01\n\n- [ ] Firmware sign-off\n- [ ] Water the plants\n')
  })
})

describe('a name moves with its line', () => {
  test('three carries leave one named line, on the newest page', () => {
    let index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })

    for (const today of ['2026-09-02', '2026-09-03', '2026-09-04']) {
      const groups = unfinished(index, today, 30)
      const decisions = groups.flatMap((group) => group.items.map(
        ({ page, index: at }) => ({ page, index: at, action: /** @type {const} */ ('keep') }),
      ))
      for (const write of carryForward(index, today, decisions)) {
        index = new Map(index).set(write.page, write.doc)
      }
    }

    assert.deepEqual(named(getPage(index, '2026-09-01')), [])
    assert.deepEqual(named(getPage(index, '2026-09-02')), [])
    assert.deepEqual(named(getPage(index, '2026-09-03')), [])
    assert.deepEqual(named(getPage(index, '2026-09-04')), ['open:k4m2qa'])
    assert.equal(idIndex(index).size, 1)
    assert.equal(lineWithId(index, 'k4m2qa')?.page, '2026-09-04')
  })

  test('the migrated line keeps its arrow and loses its name', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })
    const writes = carryForward(index, '2026-09-02', [
      { page: '2026-09-01', index: 1, action: 'keep' },
    ])
    const source = writes.find((write) => write.page === '2026-09-01')
    assert.equal(
      serialize(source?.doc ?? parse('')),
      '# 2026-09-01\n\n- [>] Firmware sign-off >2026-09-02\n',
    )
  })

  test('a dropped line keeps its name, because it did not go anywhere', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })
    const writes = carryForward(index, '2026-09-02', [
      { page: '2026-09-01', index: 1, action: 'drop' },
    ])
    assert.deepEqual(named(writes[0]?.doc ?? null), ['dropped:k4m2qa'])
  })

  test('a line dragged to another day takes its name and leaves none behind', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })
    const [to, from] = moveItem(index, '2026-09-01', 1, '2026-09-03', '2026-09-05')
    assert.deepEqual(named(to?.doc ?? null), ['open:k4m2qa'])
    assert.deepEqual(named(from?.doc ?? null), [])
    assert.equal(
      serialize(from?.doc ?? parse('')),
      '# 2026-09-01\n\n- [>] Firmware sign-off >2026-09-03\n',
    )
  })

  test('a line dragged out of a day still to come leaves no line at all', () => {
    const index = vault({
      '2026-09-04': '# 2026-09-04\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })
    const [to, from] = moveItem(index, '2026-09-04', 1, '2026-09-05', '2026-09-01')
    assert.deepEqual(named(to?.doc ?? null), ['open:k4m2qa'])
    assert.equal(serialize(from?.doc ?? parse('')), '# 2026-09-04\n\n')
  })

  test('a line sent to the back page takes its name there', () => {
    const index = vault({
      '2026-09-01': '# 2026-09-01\n\n- [ ] Firmware sign-off ^k4m2qa\n',
    })
    const [to, from] = moveItem(index, '2026-09-01', 1, SOMEDAY, '2026-09-05')
    assert.deepEqual(named(to?.doc ?? null), ['open:k4m2qa'])
    assert.equal(serialize(from?.doc ?? parse('')), '# 2026-09-01\n\n- [>] Firmware sign-off\n')
  })
})
