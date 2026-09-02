// @ts-check

/**
 * The day on screen.
 *
 * The app is left running for days at a time, and a hidden popover is not a
 * page that gets rebuilt - the webview that drew Tuesday at 5pm is the one
 * that answers the icon on Wednesday morning. So the day being shown cannot
 * be decided once, at launch, and then kept.
 *
 * The rule: a page you are on because it is today follows the clock over
 * midnight; a page you are on because it is Friday stays Friday. Told apart
 * by the day itself rather than by remembering which button was pressed, so
 * it survives the machine sleeping through several midnights at once.
 *
 * Today arrives as an argument and is never read here (spec §11.4), which is
 * also what keeps `page` still: it is what was last drawn, so a gesture aimed
 * at the fourth line of the page in front of you lands on that page even if
 * midnight has passed since. The roll-over happens at a redraw, where the
 * list moves with it.
 */

/**
 * @param {string} start today, at launch - `YYYY-MM-DD`
 * @returns {{page: () => string, tick: (today: string) => void, go: (page: string, today: string) => void}}
 */
export function createShowing(start) {
  let current = start
  /** What today was the last time this was told. */
  let asOf = start

  return {
    /**
     * The page on screen.
     *
     * @returns {string}
     */
    page: () => current,

    /**
     * Lets the clock move the page, if it is a page that follows. Called at
     * the top of every draw.
     *
     * @param {string} today `YYYY-MM-DD`
     * @returns {void}
     */
    tick(today) {
      // Today's page - either because it was today when it was last drawn,
      // or because the day has caught up with a page chosen ahead. Anything
      // else - an older day, a day further out, the back page - is being
      // read rather than lived in, and is left alone.
      if (current === asOf || current === today) current = today
      asOf = today
    },

    /**
     * Flips to another page (spec §5.1).
     *
     * @param {string} page
     * @param {string} today `YYYY-MM-DD`
     * @returns {void}
     */
    go(page, today) {
      current = page
      asOf = today
    },
  }
}
