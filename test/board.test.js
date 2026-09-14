// @ts-check

/**
 * What a board is shown of a page, and what the app believes of what it
 * hands back.
 *
 * The answer reader is the interesting half: everything it is given arrived
 * from somebody else's code and the app is about to write a file from it, so
 * every test here is a shape that must not reach `board.md`.
 */

import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { parse } from '../src/core/parse.js'
import { boardLinesOf, boardKey, readBoard } from '../src/core/board.js'

const PAGE = parse(`- [ ] Review PR #4412 @14:00
  the one about retries
- [x] Water the plants ^k4m2qa
- [>] Carried away >2026-09-03

Some prose the parser did not understand.
`)

const LINES = boardLinesOf(PAGE)

/**
 * A board answer with one column holding whatever was passed.
 *
 * @param {unknown[]} cards
 * @returns {unknown}
 */
function column(cards) {
  return { columns: [{ name: 'To do', cards }], archive: [] }
}

/**
 * The cards the reader kept, as `id|index:text` for readability.
 *
 * @param {ReturnType<typeof readBoard>} read
 * @returns {string[]}
 */
function kept(read) {
  return (read.answer?.columns ?? []).flatMap((one) =>
    one.cards.map((card) => `${card.id ?? card.index}:${card.text}`))
}

describe('what a board is shown', () => {
  test('every line the parser understood, with its index, name and state', () => {
    assert.deepEqual(LINES, [
      { index: 0, id: null, text: 'Review PR #4412', state: 'open' },
      { index: 2, id: 'k4m2qa', text: 'Water the plants', state: 'done' },
      { index: 3, id: null, text: 'Carried away', state: 'migrated' },
    ])
  })

  test('not the note under a line, and not a line the parser did not understand', () => {
    for (const line of LINES) {
      assert.doesNotMatch(line.text, /retries/u)
      assert.doesNotMatch(line.text, /prose/u)
    }
  })

  test('four states, not a boolean', () => {
    // The whole reason this slot sends more than `item.badge` does. A board
    // that is told only done-or-not cannot tell a line carried to tomorrow
    // from a line still open today, and seeds a card from the copy that was
    // left behind (spec §2.3).
    assert.deepEqual(LINES.map((line) => line.state), ['open', 'done', 'migrated'])
  })

  test('a page with nothing on it is no lines, not a failure', () => {
    assert.deepEqual(boardLinesOf(null), [])
    assert.deepEqual(boardLinesOf(parse('# Just a heading\n')), [])
  })

  test('asking mints nothing and changes nothing', () => {
    const page = parse('- [ ] Anonymous\n')
    const before = JSON.stringify(page)
    const lines = boardLinesOf(page)
    boardKey('2026-09-02', lines, '')
    readBoard(column([{ index: 0, text: 'Anonymous' }]), lines)
    assert.deepEqual(lines.map((line) => line.id), [null])
    assert.equal(JSON.stringify(page), before)
  })
})

describe('when a board is asked again', () => {
  test('the same page and the same file are the same question', () => {
    assert.equal(boardKey('2026-09-02', LINES, '## To do\n'), boardKey('2026-09-02', LINES, '## To do\n'))
  })

  test('a card dragged into another column is a new question', () => {
    // Without this the app draws a drag once and then hands back the board
    // from before it, because the lines did not change and the answer was
    // cached under them.
    const one = boardKey('2026-09-02', LINES, '## To do\n- A ^k4m2qa\n\n## Done\n')
    const two = boardKey('2026-09-02', LINES, '## To do\n\n## Done\n- A ^k4m2qa\n')
    assert.notEqual(one, two)
  })

  test('a tick is a new question', () => {
    const open = boardLinesOf(parse('- [ ] Water the plants ^k4m2qa\n'))
    const done = boardLinesOf(parse('- [x] Water the plants ^k4m2qa\n'))
    assert.notEqual(boardKey('2026-09-02', open, ''), boardKey('2026-09-02', done, ''))
  })

  test('a line that gains a name is a new question', () => {
    const before = boardLinesOf(parse('- [ ] Water the plants\n'))
    const after = boardLinesOf(parse('- [ ] Water the plants ^k4m2qa\n'))
    assert.notEqual(boardKey('2026-09-02', before, ''), boardKey('2026-09-02', after, ''))
  })

  test('the file and the lines cannot trade places', () => {
    // A hash of two things joined has to be able to tell `ab` + `c` from
    // `a` + `bc`, or a file that grows by exactly what a line lost is the
    // same question as the one before it.
    const lines = boardLinesOf(parse('- [ ] ab\n'))
    const other = boardLinesOf(parse('- [ ] a\n'))
    assert.notEqual(boardKey('2026-09-02', lines, 'c'), boardKey('2026-09-02', other, 'bc'))
  })
})

describe('an answer that is not a board', () => {
  test('nothing at all draws the file as it stands, and says nothing', () => {
    // A plugin that is slow, switched off, or has simply not answered yet is
    // not a fault, and the file is always something the tab can draw.
    for (const value of [null, undefined]) {
      const read = readBoard(value, LINES)
      assert.equal(read.answer, null)
      assert.deepEqual(read.notices, [])
    }
  })

  test('the wrong shape is refused and said', () => {
    for (const value of ['a board', 7, [], true]) {
      const read = readBoard(value, LINES)
      assert.equal(read.answer, null)
      assert.equal(read.notices.length, 1)
    }
  })

  test('an answer with no columns is refused', () => {
    const read = readBoard({ archive: [] }, LINES)
    assert.equal(read.answer, null)
    assert.match(read.notices.join(' '), /no columns/u)
  })

  test('an answer whose columns are all unreadable is refused whole', () => {
    // Not an empty board: writing `board.md` as no columns at all would lose
    // every card in it over one malformed answer.
    const read = readBoard({ columns: [7, null, 'To do'] }, LINES)
    assert.equal(read.answer, null)
  })
})

describe('the columns', () => {
  test('a column with no name is dropped, and the rest are kept', () => {
    const read = readBoard({ columns: [{ name: '', cards: [] }, { name: 'Doing', cards: [] }] }, LINES)
    assert.deepEqual(read.answer?.columns.map((one) => one.name), ['Doing'])
  })

  test('a column with no card list is dropped, and an empty one is not', () => {
    // An empty column is an ordinary column - a board's first draw is three
    // of them - so the two cases have to be told apart rather than merged.
    const read = readBoard({ columns: [{ name: 'To do' }, { name: 'Doing', cards: [] }] }, LINES)
    assert.deepEqual(read.answer?.columns.map((one) => one.name), ['Doing'])
  })

  test('the second column with a name is dropped', () => {
    // The same refusal the file's own parser makes, for the same reason: two
    // columns with one name cannot be told apart by the name.
    const read = readBoard({
      columns: [{ name: 'To do', cards: [] }, { name: 'To do', cards: [] }],
    }, LINES)
    assert.deepEqual(read.answer?.columns.map((one) => one.name), ['To do'])
  })

  test('a dropped column does not take its cards\' names down with it', () => {
    // The second `To do` is dropped for its name. If it had been read first
    // and dropped afterwards, its card would have claimed `k4m2qa` on the way
    // through and the real `Doing` card would have been dropped as a
    // duplicate - so the card would be in neither column and nothing would
    // say why.
    const read = readBoard({
      columns: [
        { name: 'To do', cards: [] },
        { name: 'To do', cards: [{ id: 'k4m2qa', text: 'In the dropped one' }] },
        { name: 'Doing', cards: [{ id: 'k4m2qa', text: 'Water the plants' }] },
      ],
    }, LINES)
    assert.deepEqual(kept(read), ['k4m2qa:Water the plants'])
  })

  test('a heading longer than a column is cut rather than refused', () => {
    const read = readBoard({ columns: [{ name: 'x'.repeat(80), cards: [] }] }, LINES)
    assert.equal(read.answer?.columns[0]?.name.length, 40)
  })

  test('columns keep the order they were answered in', () => {
    const read = readBoard({
      columns: [{ name: 'Done', cards: [] }, { name: 'To do', cards: [] }],
    }, LINES)
    assert.deepEqual(read.answer?.columns.map((one) => one.name), ['Done', 'To do'])
  })
})

describe('a card', () => {
  test('naming a line by index asks for that line to be stamped', () => {
    const read = readBoard(column([{ id: null, index: 0, text: 'Review PR #4412', ended: null }]), LINES)
    assert.deepEqual(read.answer?.columns[0]?.cards, [
      { id: null, index: 0, text: 'Review PR #4412', ended: null },
    ])
  })

  test('naming a card by id asks for no stamp', () => {
    const read = readBoard(column([{ id: 'k4m2qa', index: null, text: 'Water the plants', ended: 'done' }]), LINES)
    assert.deepEqual(read.answer?.columns[0]?.cards, [
      { id: 'k4m2qa', index: null, text: 'Water the plants', ended: 'done' },
    ])
  })

  test('an id the file has never seen is a card to make, not an error', () => {
    // A line that carried a name before any board existed is exactly this,
    // and so is a card the plugin is putting back after a restore.
    const read = readBoard(column([{ id: 'zz9zz9', index: null, text: 'From somewhere else', ended: null }]), LINES)
    assert.deepEqual(kept(read), ['zz9zz9:From somewhere else'])
  })

  test('with both an id and an index is dropped', () => {
    const read = readBoard(column([{ id: 'k4m2qa', index: 0, text: 'Which one', ended: null }]), LINES)
    assert.deepEqual(kept(read), [])
  })

  test('with neither is dropped', () => {
    const read = readBoard(column([{ id: null, index: null, text: 'Nobody', ended: null }]), LINES)
    assert.deepEqual(kept(read), [])
  })

  test('naming a line that was not sent is dropped', () => {
    // The lines may have moved while the plugin was thinking, and a card made
    // from the wrong line is a file written about the wrong task.
    const read = readBoard(column([{ index: 99, text: 'Off the end' }]), LINES)
    assert.deepEqual(kept(read), [])
  })

  test('naming a line the parser did not understand is dropped', () => {
    // Index 1 is the note under the first line, and index 4 is prose. Neither
    // was sent, so neither can be made into a card.
    const read = readBoard(column([{ index: 1, text: 'the one about retries' }, { index: 4, text: 'Some prose' }]), LINES)
    assert.deepEqual(kept(read), [])
  })

  test('with a name that is not a name is dropped', () => {
    for (const id of ['K4M2QA', 'k4m2q', 'k4m2qaa', 'k4m-qa', '', 7]) {
      assert.deepEqual(kept(readBoard(column([{ id, index: null, text: 'No' }]), LINES)), [])
    }
  })

  test('that is not an object at all is dropped, and the rest of the column is kept', () => {
    const read = readBoard(column([7, null, 'a card', { index: 0, text: 'Real' }]), LINES)
    assert.deepEqual(kept(read), ['0:Real'])
  })

  test('with no words takes the line\'s, and a named card with none is dropped', () => {
    const seeded = readBoard(column([{ index: 0 }]), LINES)
    assert.deepEqual(kept(seeded), ['0:Review PR #4412'])
    const named = readBoard(column([{ id: 'zz9zz9' }]), LINES)
    assert.deepEqual(kept(named), [])
  })

  test('keeps the words it was answered with, so a card follows its line\'s edits', () => {
    // The plugin refreshes a card's text from the day page when the line is
    // there, which is how a card stops saying what the task used to say.
    const read = readBoard(column([{ id: 'k4m2qa', text: 'Water the plants twice' }]), LINES)
    assert.deepEqual(kept(read), ['k4m2qa:Water the plants twice'])
  })

  test('cannot write a second line into the file', () => {
    // The check that matters rather than a tidiness: a card's words go into a
    // line of `board.md`, so a newline in them would write a card the file
    // never agreed to - and `- Fake ^aaaaaa` is a card the parser would read
    // back on the next draw.
    const read = readBoard(column([{ index: 0, text: 'Real\n- Fake ^aaaaaa' }]), LINES)
    assert.deepEqual(kept(read), ['0:Real - Fake ^aaaaaa'])
  })

  test('longer than a line is cut rather than refused', () => {
    const read = readBoard(column([{ index: 0, text: 'x'.repeat(500) }]), LINES)
    assert.equal(read.answer?.columns[0]?.cards[0]?.text.length, 200)
  })

  test('that ended in a way this app does not have is in flight', () => {
    // Not dropped: where a card *is* is the answer's business and how it
    // ended is a smaller claim, so an unreadable ending costs the ending
    // rather than the card.
    const read = readBoard(column([{ index: 0, text: 'Real', ended: 'binned' }]), LINES)
    assert.equal(read.answer?.columns[0]?.cards[0]?.ended, null)
  })
})

describe('a task in two places', () => {
  test('one line cannot become two cards', () => {
    const read = readBoard(column([{ index: 0, text: 'Once' }, { index: 0, text: 'Twice' }]), LINES)
    assert.deepEqual(kept(read), ['0:Once'])
  })

  test('one card cannot sit in two columns', () => {
    const read = readBoard({
      columns: [
        { name: 'To do', cards: [{ id: 'k4m2qa', text: 'Here' }] },
        { name: 'Doing', cards: [{ id: 'k4m2qa', text: 'And here' }] },
      ],
    }, LINES)
    assert.deepEqual(kept(read), ['k4m2qa:Here'])
  })

  test('a named line reached by index is the card it already is', () => {
    // Index 2 is the line holding `^k4m2qa`. Asking for it by index must not
    // mint a second name for a task that has one, and must not put it on the
    // board beside itself.
    const read = readBoard({
      columns: [
        { name: 'To do', cards: [{ id: 'k4m2qa', text: 'Water the plants' }] },
        { name: 'Doing', cards: [{ index: 2, text: 'Water the plants' }] },
      ],
    }, LINES)
    assert.deepEqual(kept(read), ['k4m2qa:Water the plants'])
  })

  test('a line reached by index that already has a name asks for no stamp', () => {
    const read = readBoard(column([{ index: 2, text: 'Water the plants' }]), LINES)
    assert.deepEqual(read.answer?.columns[0]?.cards, [
      { id: 'k4m2qa', index: null, text: 'Water the plants', ended: null },
    ])
  })
})

describe('a line that was carried away', () => {
  test('is never stamped, whoever asks', () => {
    // Index 3 is `[>] Carried away >2026-09-03`. Carrying moved its name to
    // the copy on the later day, so stamping this one mints a *second* name
    // for one task, on a page the person has already moved past. The app
    // refuses rather than trusting every board to know that (spec §2.3).
    const read = readBoard(column([{ index: 3, text: 'Carried away' }]), LINES)
    assert.deepEqual(kept(read), [])
  })

  test('and the states that are the board\'s own business are left to it', () => {
    // Open and done both seed. Where a task belongs is what a board is for,
    // and the app only refuses the write it can prove is wrong.
    const read = readBoard(column([{ index: 0, text: 'Open' }, { index: 2, text: 'Done' }]), LINES)
    assert.deepEqual(kept(read), ['0:Open', 'k4m2qa:Done'])
  })
})

describe('what the board asks to archive', () => {
  test('is a list of names', () => {
    const read = readBoard({ columns: [{ name: 'Done', cards: [] }], archive: ['k4m2qa', 'zz9zz9'] }, LINES)
    assert.deepEqual(read.answer?.archive, ['k4m2qa', 'zz9zz9'])
  })

  test('drops what is not a name, and keeps the rest', () => {
    const read = readBoard({
      columns: [{ name: 'Done', cards: [] }],
      archive: ['k4m2qa', 'NOPE', 7, null, 'k4m2qa'],
    }, LINES)
    assert.deepEqual(read.answer?.archive, ['k4m2qa'])
  })

  test('is nothing when it is missing, and said when it is the wrong shape', () => {
    const missing = readBoard({ columns: [{ name: 'Done', cards: [] }] }, LINES)
    assert.deepEqual(missing.answer?.archive, [])
    assert.deepEqual(missing.notices, [])
    const wrong = readBoard({ columns: [{ name: 'Done', cards: [] }], archive: 'k4m2qa' }, LINES)
    assert.deepEqual(wrong.answer?.archive, [])
    assert.match(wrong.notices.join(' '), /not a list/u)
  })
})

describe('what a person is told', () => {
  test('a count, not a list', () => {
    // One malformed card is worth saying; forty would be forty lines of
    // notice over a board of three.
    const read = readBoard(column([7, null, 'no', { index: 99 }]), LINES)
    assert.equal(read.notices.length, 1)
    assert.match(read.notices[0] ?? '', /4 things/u)
  })

  test('nothing at all when everything was read', () => {
    const read = readBoard(column([{ index: 0, text: 'Real' }]), LINES)
    assert.deepEqual(read.notices, [])
  })

  test('one thing, said as one thing', () => {
    const read = readBoard(column([{ index: 99 }]), LINES)
    assert.match(read.notices[0] ?? '', /1 thing this app could not read/u)
  })
})
