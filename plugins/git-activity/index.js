// @ts-check

/**
 * git-activity — what a repository saw of a day.
 *
 * A reference plugin, and the design's own test: it is written against the
 * public API with no privilege the API does not grant (spec §7.5).
 *
 * The interesting part is the shape rather than the arithmetic. A question has
 * two seconds and a command has five, so this plugin never waits for `git`
 * inside a handler. It answers from what it already knows, starts a run when it
 * knows nothing, and answers properly the next time it is asked — the next
 * time the popover is opened, or the next quarter of an hour. That is the same
 * "open it again" the calendar's permission prompt already asks for, and it is
 * why this plugin needs no way of waking the app up.
 */

/**
 * @typedef {object} Answer
 * @property {{date: string, time: null, text: string}[]} lines
 * @property {string|null} error  what went wrong, said the next time we are asked
 */

/** What each range asked about came to. @type {Map<string, Answer>} */
const answers = new Map()

/** Ranges a run is already out for, so one question does not start two.
 *  @type {Set<string>} */
const running = new Set()

planner.onContribute(({ from, to }) => {
  const at = `${from}:${to}`
  const held = answers.get(at)

  if (held !== undefined) {
    if (held.error === null) return held.lines
    // Said once, then forgotten, so the next question tries again. A plugin
    // has no way of putting a notice on the page except by failing to answer,
    // and by the time a run has failed the answer it was started for is long
    // since given.
    answers.delete(at)
    throw new Error(held.error)
  }

  if (!running.has(at)) {
    running.add(at)
    void look(at, from, to)
  }
  return []
})

/**
 * Asks `git` what happened, and remembers the answer.
 *
 * Never awaited by the handler. Everything it produces is read by a later
 * question, which is what keeps a five-second command out of a two-second
 * deadline.
 *
 * @param {string} at  the range, as its own key
 * @param {string} from `YYYY-MM-DD`
 * @param {string} to `YYYY-MM-DD`
 * @returns {Promise<void>}
 */
async function look(at, from, to) {
  // Read for the label, not for the call. `{repo}` is a `settings.repo`
  // placeholder, so the host fills it in from this same setting and refuses
  // the call - by name, and without a strike - when nobody has set one. There
  // is no check for that here, because a second one could only disagree with
  // the first.
  const repo = String(planner.settings.repo ?? '')
  try {
    const ran = await planner.capability('shell.run').run('log', { from, to })
    if (ran.status !== 0) throw new Error(complaint(ran))

    answers.set(at, { lines: linesOf(ran.stdout, repo, from), error: null })
  } catch (error) {
    answers.set(at, { lines: [], error: error instanceof Error ? error.message : String(error) })
  } finally {
    running.delete(at)
  }
}

/**
 * One line for a repository that had commits, and none for one that did not.
 *
 * Absent rather than zero: a day with no commits in it is not news, and the
 * app's own rule is that a section with nothing in it does not appear.
 *
 * @param {string} stdout  one `author\ttitle` per commit
 * @param {string} repo
 * @param {string} date  `YYYY-MM-DD`
 * @returns {{date: string, time: null, text: string}[]}
 */
function linesOf(stdout, repo, date) {
  const commits = stdout.split('\n').filter((line) => line !== '')
  if (commits.length === 0) return []

  const authors = new Set(commits.map((line) => line.split('\t')[0] ?? ''))
  // Named only when there is one of them. "6 commits by four people" is a
  // sentence about a team; this line is about a day.
  const who = authors.size === 1 ? ` by ${[...authors][0]}` : ''
  const many = commits.length === 1 ? 'commit' : 'commits'

  return [{ date, time: null, text: `${commits.length} ${many} to ${shortName(repo)}${who}` }]
}

/**
 * The last two segments of a path, which is how a repository is spoken about.
 *
 * @param {string} path
 * @returns {string}
 */
function shortName(path) {
  const parts = path.split('/').filter((one) => one !== '')
  return parts.slice(-2).join('/') || path
}

/**
 * What to say when `git` would not do it.
 *
 * Its first line of complaint, when it made one, because `git`'s first line is
 * usually the whole of it - and the app cuts everything a plugin says to one
 * line anyway.
 *
 * @param {{status: number|null, stderr: string}} ran
 * @returns {string}
 */
function complaint(ran) {
  const first = ran.stderr.split('\n').find((line) => line.trim() !== '')
  if (first !== undefined) return first.trim()
  if (ran.status === null) return 'git took too long and was stopped'
  return `git exited ${ran.status}`
}

// A file with no import and no export is a *script*, and `tsconfig.web.json`
// takes in every `plugins/**/*.js` at once - so `answers` here and `pattern`
// in ticket-links would share one global scope, and the third plugin to
// declare a `const answers` would fail the type-check with a message pointing
// at somebody else's file. This one line makes it a module. It changes nothing
// at run time: each plugin is served into a webview of its own.
export {}
