# The plugin API

A contract, like [format.md](format.md). What is written here is what a
plugin may rely on; anything else it can reach today, it may not be able to
reach tomorrow.

If it does not fit on a ruled page, it belongs in a plugin. That is the rule
this API exists to serve, and the reason it is small.

## A plugin is a folder

```
~/.planner/plugins/ticket-links/
  manifest.toml
  index.js
```

```toml
# manifest.toml
name        = "ticket-links"
version     = "0.2.0"
description = "Opens the ticket a line mentions"
entry       = "index.js"
slots       = ["item.badge"]

[permissions]
capabilities = ["shell.open"]

[permissions.open]
urls = ["settings.url"]

[settings.url]
label = "Ticket URL"
kind  = "text"
hint  = "https://github.com/org/repo/pull/$1"
```

`entry` is the file the plugin starts at, relative to its own folder. A path
that climbs out of it is refused.

## Turning one on

> **Upgrading.** `approved_slots` is new. A plugin installed before this
> version has no line for it, which reads as "approved for nothing" — it will
> run and be asked nothing until you tick its sentence in the ⌘, pane once.
> That is deliberate: a permission nobody was ever asked about is not consent.

Nothing runs because it was installed. `config.toml` decides:

```toml
[plugins.ticket-links]
enabled               = true
approved_slots        = ["item.badge"]
approved_capabilities = ["shell.open"]
approved_open         = ["https://github.com/gotab-inc/node/pull/"]

[plugins.ticket-links.settings]
url = "https://github.com/gotab-inc/node/pull/$1"
```

**The manifest is the ceiling.** A slot, a capability or an address approved
here that the manifest does not ask for is not granted, and says so on the
page. Anything the manifest asks for that is not approved here is not granted
either — the plugin still runs, and finds out when it asks.

Every field above has a row in the ⌘, pane; hand-editing this file works too,
and both write and read the same keys.

## The API

```js
// Answer a slot, named exactly as the manifest declares it.
planner.on('item.badge', ({ items }) => [
  { index: 3, label: '#4412', href: 'https://github.com/org/repo/pull/4412' },
])

// Reach something native. Refused unless it was granted.
const events = await planner.capability('macos.calendar.read').events({ from, to })
```

`plugins/planner.d.ts` in the repo says the same thing in types, and the
reference plugins are checked against it.

### `on(slot, handler)`

```js
planner.on('item.badge', ({ now, date, items }) => [
  { index: 3, label: '#4412', href: 'https://github.com/org/repo/pull/4412' },
])
```

A handler answers one slot, named exactly as `manifest.toml` declares it.
`onContribute` is `vault.contribute` under the name it has always had, and
still works.

Every question carries `now` — `{date, time}`, local — so a plugin reads what
"now" is from the question rather than holding a clock of its own. A hidden
webview's timers are throttled and its idea of the time drifts.

**Both files have to agree.** A slot the manifest declares that `config.toml`
has not approved is never asked. A slot the plugin registers a handler for
that the manifest does not declare is never asked either.

### The slots

| Slot | You are shown | You may answer with |
|---|---|---|
| `vault.contribute` | Nothing but the range of days. | `{date, time, text}[]` |
| `item.badge` | `{date, items: [{index, text}]}` — every line the parser understood on the page being drawn, and where it sits. Not its note, not its tokens, not the daily note. | `{index, label, href}[]` |
| `theme.tokens` | The clock, and `tokens` — every theme token as the theme set it. You are asked to *move* those, and cannot move what you were never shown. Not the page: what you do with colour is a function of the time of day. | `Record<string, string>` — a partial map of theme tokens |

A badge's `label` is one line, cut at 16 characters. Its `index` must be one
the question sent — the lines may have moved while you were thinking, and a
marker against the wrong line is worse than no marker. One marker per line per
plugin.

`href` is opened by the app when somebody clicks the marker. Your plugin is
not asked anything at that point and does not run at all.

### `theme.tokens`

```toml
slots = ["theme.tokens"]

[tokens]
moves = ["paper", "ink"]
```

```js
planner.on('theme.tokens', ({ now, tokens }) => ({
  paper: warmer(tokens.paper),
  ink: warmer(tokens.ink),
}))
```

Return a partial map of theme tokens. The app puts them in a rule of its own,
last in the cascade — after the theme's tokens and after its `theme.css` — so
a plugin that moves a colour can move it.

**Move what you were given.** `tokens` carries every theme token as the theme
set it, before any plugin was asked — so two plugins are shown the same
colours, and asking twice cannot drift by reading back your own last answer.
Returning colours of your own instead does not *move* a theme, it replaces it:
your plugin will look right on the theme you wrote it against and wrong on
every other. `dusk` ships the transformation rather than the destination, and
is worth reading for that alone.

You may only move what `[tokens] moves` names, and only names that are theme
tokens (`docs/themes.md` has the list). A name that is not one is dropped
before the pane ever shows it.

**Each name in `moves` is ticked on its own**, and `config.toml` holds them as
`approved_moves`. A slot that hands over a list is approved by the list rather
than by the slot's name, so a person ticking `theme.tokens` is deciding about
the colours they can see beside it. Growing `moves` in a later version does not
grant you the new ones — they appear unticked, and you are refused them until
somebody says otherwise. Name only what you will actually move.

Values go through the same checks a theme's own values get: no braces, no
semicolons, no angle brackets, no `@import`, no `url()` with a scheme in it,
no backslashes, no `image-set()` or `cross-fade()`, and no comments. A value
longer than 200 characters is dropped rather than cut — a colour cut in half
is not a shorter colour.

**Two plugins may not move the same token.** If two enabled plugins name the
same one in `moves`, the first by name keeps it and the second is refused it,
with a notice naming both. Colour is not a thing two plugins can each have
half of.

A value whose brackets or quotes do not close is refused as well. CSS consumes
an unclosed function to the end of the stylesheet, so one such value would take
every declaration after it — including another plugin's.

You are asked when the popover opens, when the fifteen-minute refresh fires,
and whenever the quarter hour turns — so a page left open across sunset is
re-asked four times over the hour. That is the resolution the clock gives you;
do not build anything that needs a finer one.

### `[contribute] heading`

```toml
slots = ["vault.contribute"]

[contribute]
heading = "From git"
```

What the day page calls your section. Every contributing plugin gets one of
its own, in name order, so two of them are told apart by what they are rather
than by which arrived first. One line, cut at 40 characters; with no heading
the section is titled with your folder's name.

A slot that needs telling something has one table, named for the slot's last
word, and it is read only when you declare that slot.

### `shell.open`

```toml
[permissions]
capabilities = ["shell.open"]

[permissions.open]
urls = ["https://github.com/org/repo/pull/"]
```

Every address you may open, listed in the manifest and ticked in the pane one
by one. A prefix must be `https:` or `http:`, carry no username, and end in a
slash.

A URL is the one way a plugin's output leaves the machine, so the check is
strict: scheme, host and port must match a prefix exactly, and the path is
compared segment by segment on the parsed URL. `https://github.com.evil.io/…`
and `…/repo/pull/../../evil/` are both refused. So is a click on an address
that is no longer approved — with a notice, and no strike against you.

An entry may also name one of your own settings, as `settings.<key>` instead
of a literal address:

```toml
[permissions.open]
urls = ["settings.url"]
```

The prefix is that setting's value, cut at its first `$`: a template such as
`https://github.com/org/repo/pull/$1` resolves to
`https://github.com/org/repo/pull/` — everything before the first placeholder.
A value with no placeholder is used whole. With no value set, there is no
prefix, nothing is offered to tick, and a click is refused with a notice
rather than falling back to anything wider. This is what lets a person whose
tickets live on a different host use the plugin at all: the address is theirs,
typed into the pane, and typing it is the approval.

### `shell.run`

```toml
[permissions]
capabilities = ["shell.run"]

[permissions.run.log]
command = ["git", "-C", "{repo}", "-c", "log.showSignature=false", "log", "--since={from} 00:00", "--until={to} 23:59", "--format=%an%x09%s"]
repo    = "settings.repo"
from    = "date"
to      = "date"
```

```js
const { status, stdout, stderr } = await planner.capability('shell.run')
  .run('log', { from, to })
```

Every command you may run, declared by name as an **argument list** — never as
a shell line, because there is no shell. Placeholders are `{name}`, substituted
inside a single argument, so the list stays the length you wrote it and a bound
value can never become two arguments.

Each placeholder needs a rule in the same table, and the rule decides where
its value comes from — which is why you pass `{from, to}` above and not
`{repo}`:

- `"date"` — **you pass it**, as a `YYYY-MM-DD`. Only you know which day you
  are answering about.
- `"settings.<key>"` — **it is filled in for you**, from that setting, and
  what you pass under that name is ignored. The setting must have been set by
  the person: a value that is only your manifest's `default` does not bind and
  the call is refused, because a default is your string and the settings pane
  is meant to show theirs.

The second of those is why you never have to think about a setting's type. A
`count` reaches you through `planner.settings` as a number and reaches the
command line as its digits, and nothing you do decides which.

A leading `~` in a bound value is expanded for you. The program — the first
element — may not contain a placeholder: the pane shows the rendered line and
the tick beside it is the approval, and nobody can approve a program they
cannot see.

**Approval is of the rendered line.** The pane shows each command as one line
and offers to copy it; `config.toml` holds that line under the command's name
in `[plugins.<you>.run]`. Change an argument and the manifest renders to a
different line, which is not the one that was ticked — so it shows up
unapproved rather than running.

The line is rendered by a rule, so that you and the pane and the person
pasting it into an editor all produce the same string: arguments joined with
single spaces, and any argument not made entirely of `A-Za-z0-9_@%+=:,./{}-`
wrapped in single quotes, with an inner `'` written as `'\''`. Every argument
must be printable ASCII — a tab and a non-breaking space are drawn as a space
and would make the line lie about where one argument ends and the next begins.

Each placeholder is written with its rule inside it: `{repo}` bound to
`settings.repo` renders as `{repo=settings.repo}`. The stored line is the
approval, so it has to carry everything that decides what runs — otherwise a
later version of your plugin could keep its arguments, move `{repo}` from
`settings.repo` to `settings.token`, and keep its tick.

Everything in `argv` is a string, so a `count` setting arrives on the command
line as its digits. Reading the same setting through `planner.settings` still
gives you the number — the two are separate paths and neither goes through the
other.

**What actually runs.** No shell. The program is looked up on the PATH a login
shell would have; given as a path it must be absolute and outside
`~/.planner`. The working directory is the home directory and the environment
is `PATH`, `HOME` and `LANG` and nothing else. Five seconds, then the process
group is killed. You get `{status, stdout, stderr}` — `status` is null when it
was killed, `stdout` is cut at 256 KiB and `stderr` at 4 KiB.

**What approval by reading can and cannot do.** The program is fixed and the
whole line is shown, so nothing runs that a person did not read. But reading is
the whole of it: plenty of ordinary programs have argument surfaces that amount
to running something else — `git -c core.sshCommand=…`, `git -c alias.x=!…`,
`find -exec`, `env`, any interpreter. A manifest may declare those and the line
will look plausible. The tick is a judgement about a command, not a proof that
the command is harmless, and this app does not pretend to make it one.

**Both ticks are needed.** `shell.run` is the capability and the line is the
command; the pane shows them as two boxes and both have to be ticked. Neither
order is wrong, and the pane says when only one of them is.

**A refused binding is a strike.** The manifest is your own file, so a call
that does not match what it declared is not a misunderstanding. In practice
that means a `date` that is not a `YYYY-MM-DD`, or a command name you were
never granted. Three of those and the plugin is put away for the session.

Two things that are *not* strikes, because neither is your fault: `shell.run`
not being ticked, and a `settings.<key>` the person has not filled in. Both are
refused with a reason you can show. And a setting of the wrong type is not
possible: you do not pass it.

A capability call is not a question and has no two-second deadline of its own —
but a question does. Do not hold a question open across a `run`: answer with
what you have, start the run, and answer properly the next time you are asked.
That is what the fifteen-minute refresh and the popover opening are for.

### `onContribute`

Called with `{from, to}`, each `YYYY-MM-DD` local, inclusive. Return — or
resolve to — an array of `{date, time, text}`:

| Field | |
|---|---|
| `date` | `YYYY-MM-DD`, local. A date outside the range asked for is ignored, not an error. |
| `time` | `HH:MM`, local, 24-hour. `null` for something that takes the whole day. |
| `text` | One line. Whitespace is collapsed and anything past 200 characters is cut. |

Contributed lines are read-only. They have no checkbox, cannot be edited,
struck out or dragged, and never count towards how much is left on the day —
the count is what is open in your file, and a meeting is not in your file.

Anything the app cannot read is dropped and counted, and the day page says
how many. It is never guessed at.

### `capability(name)`

| Capability | Method | Returns |
|---|---|---|
| `macos.calendar.read` | `events({from, to})` | `{date, time, text, allDay, status}[]` |
| `macos.location.read` | `location()` | `{latitude, longitude}` |

`status` is `confirmed`, `tentative`, `cancelled` or `none`. Deciding what to
do about a cancelled meeting is the plugin's job; the bridge has no opinion.

The first call after the plugin is enabled asks macOS for permission and
fails politely while the prompt is up. Open the popover again once you have
allowed it.

`events` may be asked about at most 62 days at a time. A wider range is
refused with an error rather than trimmed, because a plugin that asked for a
decade should find out that it did.

```js
const { latitude, longitude } = await planner.capability('macos.location.read').location()
```

`macos.location.read` answers with where this Mac is, rounded to two decimal
places — about a kilometre, which is what sunrise arithmetic needs and less
than a plugin needs to know about where somebody lives. There is no finer
version of this to ask for.

It rejects while macOS is still asking for permission, and again while it has
no fix yet. Both are ordinary: ask again the next time you are asked
something. It rejects for good if location services are off, and the message
says so — which is why `dusk` also has a `location` setting, and why yours
should too.

### Settings

A plugin can declare its own settings, and the ⌘, pane draws a row for each
one, right below the plugin's ticks:

```toml
[settings.pattern]
label   = "Ticket pattern"
kind    = "text"
default = "#(\\d+)"

[settings.url]
label = "Ticket URL"
kind  = "text"
hint  = "https://github.com/org/repo/pull/$1"
```

| Field | |
|---|---|
| `label` | What the pane shows next to the row. Required. |
| `kind` | `text`, `count` or `switch` — the only three. Required. |
| `default` | The value used until the person types one, matching `kind`. Optional; `url` above has none on purpose, since a default here would be the author's host, not yours. |
| `hint` | A placeholder shown in an empty `text` or `count` field. Optional. |

A setting with no `default` is **absent** from `planner.settings` until
somebody sets one — not present and empty. Read it with `??`, the way
`ticket-links` does with `String(planner.settings.url ?? '')`, or the first
run on a fresh install throws.

A key that will not do — no label, an unknown kind, a default of the wrong
type — is dropped with a notice; the rest of the settings, and the plugin
itself, still work.

Your own values live under `[plugins.<name>.settings]` in `config.toml`, one
key per setting, written by the pane the moment a row changes. The plugin
reads them back as `planner.settings`, a frozen object keyed the same way —
never a `Map`, and never anything the plugin wrote itself. Its value is
embedded into the page with the same HTML-safe encoding as everything else a
plugin is served, so a setting containing `</script>` cannot end the page
early.

**Changing a setting restarts the plugin**, the same as changing a slot, a
capability or an address does — the code never runs with a settings value it
did not start with.

## What is stopping you

Worth knowing, because it explains the shape of everything above.

A plugin runs in its own hidden webview at `plugin://<name>/`, served only
from its own folder, and it cannot leave that origin: a navigation anywhere
else — `location.href`, a form post, a link — is refused, and three of them
put the plugin away. It has no core permissions, so it cannot listen for or
emit any of the app's events. It may call exactly one command,
`plugin_message`, and every message through it is checked against the
capabilities the manifest and the config both agreed on.

It cannot reach the network. `connect-src 'none'` closes `fetch`,
`XMLHttpRequest`, `sendBeacon` and websockets; `RTCPeerConnection` and the
rest of WebRTC are removed from every frame before the plugin's code runs,
because a `stun:` hostname is a network request no CSP directive covers.
Whatever a plugin needs from outside, it asks for as a capability.

One message may carry a megabyte, and one capability call may be in flight at
a time. A second call while the first is running is refused with an error and
is not held against the plugin; a message over the megabyte is.

Every question has a two-second deadline. A plugin that throws, hangs,
overruns, asks three times for something it was never granted, keeps trying to
navigate away, or answers a question put to a different plugin, is put away for
the session — its webview closed, not merely ignored — with a line on the page
saying so. Switching it off and on again in the settings pane does not undo
that; relaunching the app does. The day page never waits for a plugin: it draws
without contributions and again if they arrive.

A plugin folder must be named in lowercase letters, digits and hyphens,
starting with a letter or a digit, at most 64 characters. A folder named
anything else is listed in the settings pane with the reason and never started:
the name becomes a URL host, a window label and a `config.toml` table header,
and a header is written to that file verbatim.

A plugin is asked only what both files agree on. `slots` in the manifest says
what it can answer; `approved_slots` in `config.toml` says what it will be
asked. A slot is not reach — it is what the plugin is *shown* — and it is
ticked for exactly that reason: `item.badge` hands a plugin the text of every
line on the page you are looking at, and the pane says so in a sentence next
to the tick.

Switching a plugin off in the pane stops it and closes its webview, without a
restart. Changing anything else about it — a slot, a capability, an address —
restarts it, so the code never runs with a configuration it did not start
with. A plugin put away for the session stays put away through every toggle,
and the pane says what it did.

## Not in v1

`onRender`, `planner.storage`, `planner.vault.read`, `net.fetch`, `fs.read`,
the `job` slot, and the `page.section` slot. Each arrives when something
needs it. A slot with no consumer is a guess about an API.
