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
}

declare const planner: {
  /** Supply items for a range of days. The one slot in v1. */
  onContribute(
    handler: (range: Planner.Range) =>
      Planner.Contribution[] | Promise<Planner.Contribution[]>,
  ): void

  /**
   * Reach something native. Refused unless the manifest asked for this
   * capability and `config.toml` granted it.
   */
  capability(name: 'macos.calendar.read'): Planner.CalendarCapability
}
