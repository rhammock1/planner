// @ts-check

/**
 * The kinds of tick the plugin pane draws.
 *
 * Its own file, apart from `tick.js`, because two things have to agree about
 * this list and only one of them can import a view: `components.css` styles a
 * row by its kind, and a kind with no rule renders as an unstyled label - much
 * larger than the rows around it, inline rather than one to a line, and
 * running off the edge of the pane. That is what `theme.tokens`' `token` did
 * when it was added and the stylesheet was not.
 *
 * Written down twice, so neither copy can drift alone: the union is what a
 * call site is checked against, and `test/tickStyles.test.js` reads the array
 * to check the stylesheet has a rule for every one of them.
 */

/** @typedef {'slot'|'token'|'capability'|'address'|'command'} TickKind */

/** @type {readonly TickKind[]} */
export const TICK_KINDS = ['slot', 'token', 'capability', 'address', 'command']
