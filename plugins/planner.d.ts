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

  /** What a command left behind. */
  interface Ran {
    /** Its exit code, or null when it overran and was killed. */
    status: number | null
    /** Cut at 256 KiB. */
    stdout: string
    /** Cut at 4 KiB. */
    stderr: string
  }

  interface RunCapability {
    /**
     * Runs a command your manifest declared.
     *
     * `values` carries one entry per `date` placeholder and nothing else: a
     * `settings.<key>` placeholder is filled in from the setting, and a value
     * passed under its name is ignored.
     *
     * Rejects if a date is not a `YYYY-MM-DD`, and that rejection is a strike
     * against your plugin: the manifest is your own file, so a value it would
     * not accept is not a misunderstanding you could have had.
     *
     * Two rejections are *not* strikes, because neither is your doing: a
     * `settings.<key>` whose setting nobody has filled in, and a `shell.run`
     * the person has not ticked. Both say so in the message, so you can put
     * it on the page.
     */
    run(name: string, values: Record<string, string>): Promise<Ran>
  }

  /** Where this Mac is, rounded to two decimal places - about a kilometre. */
  interface Place {
    latitude: number
    longitude: number
  }

  interface LocationCapability {
    /**
     * Rejects while macOS is still asking, and while it has no fix yet. Both
     * are ordinary: ask again the next time you are asked something.
     */
    location(): Promise<Place>
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

  /** The question behind the `page.note` slot. */
  interface SectionQuestion {
    now: Now
    /** The page being drawn, `YYYY-MM-DD`. */
    date: string
    /** Which of *your* sidecars exist on that day. Never anybody else's. */
    sidecars: { suffix: string; title: string }[]
  }

  /** A block you are asking for. A suffix that exists is a block to type in;
   *  one that does not is an offer, and needs a title to write on it. */
  interface SectionAnswer {
    suffix: string
    title?: string
  }

  /** The question behind the `search.provide` slot. */
  interface SearchQuestion {
    now: Now
    /** Exactly what was typed into ⌘F. */
    query: string
  }

  /** One result of yours. `date` jumps to that day; `href` is a `sidecar:`
   *  of yours and nothing else - a URL is dropped. */
  interface SearchHit {
    text: string
    date?: string
    href?: string
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

  /** The question behind the `item.action` slot. A line you picked, and the
   *  page it is on. */
  interface ActionQuestion {
    now: Now
    /** The page being drawn, `YYYY-MM-DD`. A note you make belongs beside
     *  this day, not beside today - the app refuses any other. */
    date: string
    /** Where the line sits on the page. */
    index: number
    /** What the line says, as it reads on screen - which may be a word ahead
     *  of the file if it is being typed into. */
    text: string
  }

  /** The one thing an action may answer with: a `sidecar:` of yours to show,
   *  creating it if it is not there. Answer `null` when this line means
   *  nothing to you. */
  interface ActionAnswer {
    open: string
  }

  /** The question behind the `theme.tokens` slot. The clock, and the colours
   *  the theme itself set - you are asked to *move* those, and cannot move
   *  what you were never shown. Not the page: what you do with colour is a
   *  function of the time of day. */
  interface TokensQuestion {
    now: Now
    /**
     * Every theme token, as the theme set it, before any plugin was asked.
     * So two plugins are shown the same colours, and asking twice cannot
     * drift by reading back your own last answer.
     */
    tokens: Record<string, string>
  }

  /** One file beside a day, as a listing names it. */
  interface SidecarFile {
    /** `YYYY-MM-DD`, the day it sits beside. */
    date: string
    /** The name after the date, which begins with a prefix your manifest declared. */
    suffix: string
    /** Its first `# ` line, or the suffix when it has none. */
    title: string
  }

  interface SidecarCapability {
    /**
     * Every sidecar of yours between two dates, inclusive, in date then
     * suffix order.
     *
     * A range rather than a day, and one call rather than sixty: a range
     * wider than 366 days is refused, and a listing is cut at 500 with the
     * newest kept.
     */
    list(range: Range): Promise<SidecarFile[]>
    /**
     * One of your sidecars, as text.
     *
     * Rejects for a file that is not there and for a suffix outside the
     * prefixes your manifest declared - with the same message, because which
     * of the two it is is not yours to know. Neither is a strike.
     */
    read(date: string, suffix: string): Promise<string>
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
  on(slot: 'item.action', handler: (question: Planner.ActionQuestion) =>
    Planner.ActionAnswer | null | Promise<Planner.ActionAnswer | null>): void
  on(slot: 'theme.tokens', handler: (question: Planner.TokensQuestion) =>
    Record<string, string> | Promise<Record<string, string>>): void
  on(slot: 'page.note', handler: (question: Planner.SectionQuestion) =>
    Planner.SectionAnswer[] | Promise<Planner.SectionAnswer[]>): void
  on(slot: 'search.provide', handler: (question: Planner.SearchQuestion) =>
    Planner.SearchHit[] | Promise<Planner.SearchHit[]>): void

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

  capability(name: 'shell.run'): Planner.RunCapability

  capability(name: 'macos.location.read'): Planner.LocationCapability

  capability(name: 'vault.sidecar.read'): Planner.SidecarCapability

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
