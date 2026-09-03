/**
 * The `planner` object a plugin is given (spec §7.3).
 *
 * Declarations only - nothing here ships. It exists so the reference plugins
 * are type-checked against the API they are meant to be testing: the moment
 * the host changes shape and this file is not updated with it, the plugins
 * stop compiling, which is the point of having them.
 *
 * A plugin author is welcome to this file; the prose version is
 * `docs/plugins.md`.
 */

declare namespace Planner {
  /** The days being asked about, inclusive, each `YYYY-MM-DD`. */
  interface Range {
    from: string
    to: string
  }

  /** A line a plugin puts on a day. */
  interface Contribution {
    /** `YYYY-MM-DD`, local. */
    date: string
    /** `HH:MM`, local, or null for something that takes the whole day. */
    time: string | null
    text: string
  }

  /** What `macos.calendar.read` hands back. Dates are already local. */
  interface CalendarEvent extends Contribution {
    allDay: boolean
    /** `confirmed`, `tentative`, `cancelled`, or `none`. */
    status: string
  }

  interface CalendarCapability {
    events(range: Range): Promise<CalendarEvent[]>
  }

  /** What every question carries: the day and the time it was asked. */
  interface Now {
    /** `YYYY-MM-DD`, local. */
    date: string
    /** `HH:MM`, local, 24-hour. */
    time: string
  }

  /** The question behind `onContribute`. */
  interface ContributeQuestion extends Range {
    now: Now
  }

  /** A line the app drew, and where it sits on the page. */
  interface Line {
    index: number
    text: string
  }

  /** The question behind the `item.badge` slot. */
  interface BadgeQuestion {
    now: Now
    /** The page being drawn, `YYYY-MM-DD`. */
    date: string
    items: Line[]
  }

  /** A marker after a line. */
  interface Badge {
    /** The `index` of the line this belongs to, from the question. */
    index: number
    /** One line, cut at 16 characters. */
    label: string
    /** Opened by the app when it is clicked, if the config approves it. */
    href: string
  }
}

declare const planner: {
  /** Answer a question, by the slot's own name. */
  on(slot: 'vault.contribute', handler: (question: Planner.ContributeQuestion) =>
    Planner.Contribution[] | Promise<Planner.Contribution[]>): void
  on(slot: 'item.badge', handler: (question: Planner.BadgeQuestion) =>
    Planner.Badge[] | Promise<Planner.Badge[]>): void

  /** `vault.contribute` under the name it has always had. */
  onContribute(
    handler: (question: Planner.ContributeQuestion) =>
      Planner.Contribution[] | Promise<Planner.Contribution[]>,
  ): void

  /**
   * Reach something native. Refused unless the manifest asked for this
   * capability and `config.toml` granted it.
   */
  capability(name: 'macos.calendar.read'): Planner.CalendarCapability

  /**
   * This plugin's own settings, as `config.toml` holds them, keyed the way
   * `[settings.*]` in the manifest named them.
   *
   * `Partial`, and that is the interesting half: a setting the manifest
   * declared with no `default` and nobody has set is *absent*, not empty. So
   * read one with `??` - `String(planner.settings.url ?? '')` - rather than
   * reaching straight through it.
   *
   * Never changes while the plugin is running: a change in the settings pane
   * restarts it.
   */
  readonly settings: Readonly<Partial<Record<string, string | number | boolean>>>
}
