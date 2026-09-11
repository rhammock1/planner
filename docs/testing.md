# Testing

Almost everything in this app is tested without launching it. What is left is
the part that only an operating system can answer for.

## What runs on its own

```bash
npm test          # node --test over test/*.test.js
npm run typecheck # tsc as a checker; no build step, no emit
cd src-tauri && cargo test
npm run serve     # then open test/browser/*.html for the layout checks
```

The browser checks are the ones that need a real layout engine: whether the
footer stays on screen, whether the list is what scrolls, whether an overlay
covers the page. They print a pass count at the top of the page.

## The smoke checklist (spec §9)

These are the ones worth doing by hand, because the thing being checked is the
operating system's behaviour rather than this app's. Run against a throwaway
setup so a mistake costs nothing:

```bash
PLANNER_HOME="$TMPDIR/planner-home" npm run app
```

**The menu bar item**

- [ ] The icon appears, and nothing appears in the dock.
- [ ] Clicking it opens the page under it — on a second display too, and near
      the right-hand edge of the screen.
- [ ] Clicking it again puts the page away. So does clicking elsewhere, unless
      the page is pinned.
- [ ] The icon carries today's open count, and a dot when a deadline is inside
      its lead time. Turning `menu_bar_count` off leaves the dot; turning both
      off leaves a bare icon.

**Quick add**

- [ ] `⌥Space` opens the field from any app, including full-screen ones.
- [ ] The line lands on today, and the window closes.
- [ ] Changing `hotkey` in settings takes effect without a restart.

**Notifications**

- [ ] A line with `@` a minute from now fires a notification at that minute.
- [ ] Its title is the line and its body is the time.
- [ ] Ticking the line off before the time comes stops it firing.
- [ ] Closing the laptop over a timed line and opening it an hour later fires
      nothing — being told late is worse than not being told.
- [ ] Leaving the app running overnight still announces the next morning's
      lines. This is the one the fifteen-minute refresh exists for.
- [ ] With the second window open, the fifteen-minute refresh reaches it as
      well as the popover: a plugin's lines and colours follow the clock in
      both. (Easiest with `dusk` and the machine clock moved past sunset.)

**Windows**

- [ ] The pinned page can be dragged by its header and stays where it is put.
- [ ] The page can be resized, and the list scrolls inside whatever size it
      has.
- [ ] `⌘↩` opens the second window, and the footer's tabs switch it.

**The command line**

- [ ] `planner ~/Planner/A-RUMBLING-OF-THUNDER.md` with the app not running
      launches it and opens the file.
- [ ] The same command with the app already running opens the file in the
      window that is already there, and no second menu bar icon appears.
- [ ] The window comes to the front, rather than raising behind the terminal.
      This is the one worth watching: the app is an accessory with no dock
      icon, and whatever invoked it is a terminal that is frontmost.
- [ ] Bare `planner` with the app already running opens today's page. This is
      the way in when a full menu bar has hidden the icon.
- [ ] `planner nope.txt`, `planner /nowhere/x.md` and `planner --wat` each
      refuse on stderr and exit 2 — with the app running *and* without it.
- [ ] `planner --help` and `planner --version` print and exit without
      launching anything.
- [ ] Editing the open file in nvim shows up in the window within a second or
      two, and typing in the window shows up in nvim.
- [ ] A file outside the vault opens, edits and saves, and the window says it
      is not being watched.
- [ ] `planner ~/Planner/new-one.md` on a file that is not there opens blank
      saying **New file**, and the file appears on disk a second after the
      first keystroke.
- [ ] Type into the file and press ⌘W immediately. Reopen the window: the
      text is there.

**The vault**

- [ ] An edit made in a text editor shows up in the app within a second.
- [ ] Pointing `vault` at a folder that is not there gives a notice and a
      folder picker, and picking one writes the path into `config.toml`
      without disturbing the comments.
- [ ] `⌘E` opens the day in the editor `config.toml` names. With `editor`
      empty it opens in whatever the system opens Markdown with.

**Plugins**

- [ ] With `macos-calendar` switched on, granting the calendar permission when
      macOS asks makes the day's events appear the next time the popover is
      opened.
- [ ] Turning it off in settings and reopening the popover leaves the section
      empty.
- [ ] Unticking `macos.calendar.read` while leaving the plugin on gives a
      notice saying the plugin asked for something the config has not
      approved.
- [ ] A plugin whose entry sets `location.href` to a website is refused, the
      site never loads, and the app carries on. Three tries put it away.
- [ ] A plugin that never answers is put away after two seconds *and* its
      webview goes: the app's `WebContent` process count in Activity Monitor
      drops within a second or two.
- [ ] A plugin put away, then switched off and on again in the settings pane,
      stays put away until the app is relaunched.
- [ ] With a plugin holding a capability call open, typing in the add row is
      answered at once. The door does not sit on the main thread.
- [ ] A folder in `~/.planner/plugins` named `Ticket Links` is listed in the
      settings pane with the reason and never starts.
- [ ] With `git-activity` installed and a repository typed into its pane row,
      ticking `shell.run` and the command line under it makes a
      `FROM GIT` section appear on the *second* open of the popover, reading
      `6 commits to org/repo by Someone`. The calendar's section keeps its own
      heading, and the two are in name order.
- [ ] The same day in a repository with no commits that day shows no `FROM GIT`
      section at all — not an empty one.
- [ ] Changing the repository in the pane restarts the plugin and the line
      follows on the next open.
- [ ] Emptying the repository row gives a notice naming the `repo` setting as
      unset, and no section. The plugin is *not* put away for it however many
      times the page is drawn — an empty settings row is not a strike.
- [ ] Pointing it at a folder that is not a repository gives `git`'s own first
      line of complaint as a notice.
- [ ] Editing `[plugins.git-activity.run].log` in a text editor by one
      character, then quitting and reopening the app, shows the command
      unticked in the pane and no section. (The relaunch is not incidental:
      the vault is watched, `~/.planner/config.toml` is not.)
- [ ] With `git-activity` running, the popover opens and the add row accepts
      typing while `git` is working. A command does not hold the door.
- [ ] A command that will not finish — point `repo` at a repository and
      temporarily add `["sleep", "30"]`-style arguments to a copy of the plugin
      — gives a notice within about five seconds, and `ps` shows nothing left
      behind.
- [ ] With `ticket-links` installed, its sentence is unticked in the pane and
      no marker appears. Tick it, and `#4412` on a line grows a marker without
      a restart.
- [ ] Clicking the marker opens the pull request in the browser. A line with
      no ticket has no marker and no gap where one would be.
- [ ] Unticking the address under `shell.open` leaves the marker on the page
      and refuses the click with a notice.
- [ ] Editing a line re-asks: the marker follows `#4412` to `#4413`, and
      typing in the daily note re-asks nothing.
- [ ] Toggling a plugin off in the pane: its webview is gone — the app's
      `WebContent` count in Activity Monitor drops — and its lines leave the
      page, without a restart. Toggling it on brings both back with no notice.
- [ ] A manifest edited to add a slot shows the new sentence unticked, and the
      plugin is not asked that question until it is ticked.
- [ ] A plugin whose manifest declares `item.badge` and whose code registers
      nothing gives one notice rather than two seconds of nothing.
- [ ] A plugin put away for hanging shows the reason in the pane, and still
      shows it after being switched off and on again.
- [ ] Two plugins both answering `item.badge` put two markers on the line, in
      name order, and one slow one does not delay the other's marker by two
      seconds.
- [ ] Change `ticket-links`' Ticket URL in the pane: the plugin restarts and
      the next marker opens the new host. The old webview is gone.
- [ ] Clear the Ticket URL: no prefix is approved, the plugin answers with one
      notice saying no ticket URL has been set, and no marker draws — the rest
      of the page is unaffected.
- [ ] Put `</script>` in a text setting: the plugin still loads and still
      answers. The page it is served is not ended by its own settings.
- [ ] Type a pattern that is not a regular expression: one notice, and the
      rest of the page is unaffected.

**`dusk`, and the one thing that needs a bundle**

macOS will not ask for a permission on behalf of a bare `cargo` binary. It
embeds `Info.plist` but does not seal it into the signature — `codesign -dv`
says `Info.plist=not bound` — and TCC ignores an unbound one, so the ask
returns, the status stays `NotDetermined`, and the plugin looks like it is
quietly answering nothing. These six are therefore run from the bundle:

```bash
PLANNER_HOME="$TMPDIR/planner-home" tools/update
PLANNER_HOME="$TMPDIR/planner-home" ~/.cache/planner-target/Planner.app/Contents/MacOS/planner
```

Two things about that bundle have to be right at once, and each fails the same
silent way — the ask returns, the status stays `NotDetermined`, and the plugin
looks like it is answering nothing. `tools/rebuild --bundle` asserts both where
it makes them:

  - the `Info.plist` is sealed into the signature, or TCC will not read it;
  - the signature carries the entitlements in `src-tauri/Entitlements.plist`,
    or the hardened runtime refuses. `locationd` says so and nothing else does:
    `doesn't have the entitlement, not sending #AuthPrompt`.

The bundle is signed ad hoc, so its signature changes every time it is built
and macOS asks again on each rebuild. That is a nuisance rather than a bug —
and it is also why nothing here leaves a permission granted behind it.

- [ ] With `dusk` switched on and its slot ticked, macOS asks for location the
      first time; allowing it and reopening the popover warms the page after
      sunset. Before sunset the page is exactly the theme's own colours.
- [ ] Setting the machine clock to 21:00 warms it; 16:00 cools it back. Both
      the popover and the second window, and the second window follows the
      clock while it is left open.
- [ ] Refusing location, or turning location services off, gives a notice
      naming the setting. Typing a coordinate into the plugin's row makes it
      work anyway. The row's hint is a format and not a coordinate, on purpose:
      a plausible one there is read as the answer the field already holds.
- [ ] The same plugin under `npm run app` (or `tools/update --no-bundle`) says
      macOS *does not see this process as an app* and names the setting, rather
      than saying it is asking for a prompt that is never coming. This is the
      one check that wants the bare binary.
- [ ] Launched by the path above, `lsappinfo list | grep -A4 planner-target`
      says `bundleID="io.hammock.planner"` and `type="UIElement"`. Through a
      symlink to that same file it says `bundleID=[ NULL ]` — the identity
      comes from the path a process was executed as, not from what it resolves
      to, and without one nothing is ever prompted.
- [ ] Every tick in the plugin pane is one row of small grey type: the seven
      `Moves <colour>` rows line up with the sentence above them rather than
      running together at the body size.
- [ ] With a `theme.css` that sets `--paper` on `:root`, `dusk` still moves it:
      a plugin's rule is last.
- [ ] Two plugins declaring `moves = ["paper"]` — copy `dusk` to a second
      folder — gives one notice naming both, and only the first by name moves
      anything.
- [ ] `dusk` imports `sun.js` from its own folder, which is the check that a
      plugin may be more than one file.
