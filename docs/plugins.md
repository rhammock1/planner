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

**Nothing outside the folder comes with it.** `tools/update` installs a
plugin by copying this folder alone, and the plugin is then served from
`plugin://<name>/`, an origin that refuses any path climbing out of it — so
a relative `import` reaching outside your own files will type-check in this
checkout and 404 the moment somebody installs you. If your code needs
something from elsewhere, copy it in.

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
| `page.section` | `{date, sidecars: [{suffix, title}]}` — which of *your* files exist on that day, and never anybody else's. | `{suffix, title?}[]` |
| `item.action` | `{date, index, text}` — the line under the caret when `⌘⇧N` was pressed. | `{open: 'sidecar:…'}` or `null` |
| `search.provide` | `{query}` — exactly what was typed into ⌘F. | `{text, date?, href?}[]` |

A badge's `label` is one line, cut at 16 characters. Its `index` must be one
the question sent — the lines may have moved while you were thinking, and a
marker against the wrong line is worse than no marker. One marker per line per
plugin.

`href` is opened by the app when somebody clicks the marker. Your plugin is
not asked anything at that point and does not run at all.

`href` may instead be a `sidecar:` ref of your own — checked against your
prefixes exactly as every other `sidecar:` href is (spec §4.1), and refused
with a notice if it names a file outside them. Clicking a marker that names
one of yours opens that note, which is how `task-notes` builds its `✎`.
**A marker never creates a note** — the app opens it with no title to write,
so a marker that turns out to name nothing gets a notice, not a file. In the
detached window, clicking such a marker moves to the week the note's day
sits in — that window has no block to put a caret in — switching to the week
view if you clicked it from the someday tab.

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
longer than 400 characters is dropped rather than cut — a colour cut in half
is not a shorter colour.

`texture` is the one token that is a whole background layer rather than a
value, so it may carry its own position and size and may be several layers
deep. That is what lets you stack something over a theme's own grain instead
of deleting it — the theme's value is in `tokens`, so put it last and it stays
under yours:

```js
texture: `linear-gradient(180deg, #3f4a8380, transparent 58%), ${tokens.texture}`
```

Each layer keeps its own geometry, so a theme's 14-pixel dot grid still tiles
while your gradient fills the page. If a theme's texture is long enough that
adding it would take you past the limit, drop *its* layer rather than yours: a
value refused whole is no texture at all.

**Two plugins may not move the same token.** If two enabled plugins name the
same one in `moves`, the first by name keeps it and the second is refused it,
with a notice naming both. Colour is not a thing two plugins can each have
half of.

A value whose brackets or quotes do not close is refused as well. CSS consumes
an unclosed function to the end of the stylesheet, so one such value would take
every declaration after it — including another plugin's.

You are asked when the popover opens, when the fifteen-minute refresh fires,
and **on the turn of every minute** while a window is open — so a page left
open across sunset follows the sky rather than stepping after it. The clock
runs only while some plugin has actually claimed a colour, so a vault without
one costs nothing.

Which makes the shape of the answer yours. There is no transition between two
of your answers and there is not meant to be: the app applies what you last
said. Something you want to arrive gradually is a curve you draw a minute at a
time; something you want to arrive at once is a step — which is the only way to
hand a page from dark ink to light without it passing through a moment of being
neither. `dusk` does both, and is worth reading for that.

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

### `vault.sidecar.read`

A file beside a day, named for the day and for you:

```
~/Planner/2026/09/2026-09-01.meeting-standup.md
```

Declare the prefixes you own. A suffix is yours when it *is* one of your
prefixes, or begins with one of them and a hyphen:

```toml
[permissions]
capabilities = ["vault.sidecar.read"]

[sidecars]
prefixes = ["meeting"]
```

A prefix is lowercase words joined by single hyphens, at most 15 characters —
short, because your prefix and a title have to fit in 64 together. Two enabled
plugins cannot own the same prefix: the second in name order loses that claim
and keeps its others, and the settings pane says so.

```js
const notes = planner.capability('vault.sidecar.read')

const mine = await notes.list({ from: '2026-08-01', to: '2026-09-30' })
// [{ date: '2026-09-01', suffix: 'meeting-standup', title: 'Standup' }]

const text = await notes.read('2026-09-01', 'meeting-standup')
```

`list` takes a range because a call per day is sixty calls: ask for the window
you need in one. A range wider than 366 days is refused, and a listing is cut
at 500 with the newest kept. `read` rejects for a file that is not there and
for a suffix that is not yours, with the same sentence — neither is a strike.

**You cannot write one.** There is no `vault.sidecar.write`. You *name* a
sidecar, and the app opens a block on the day page that the person types
into, and the app writes it — the surface that lets you name one is
`page.section`, below. A plugin relaying keystrokes back through the door to
write what the app already has is not a feature this API is missing.

### `page.section`

A block under the day, kept in a file beside the day's:

```toml
slots = ["page.section"]

[sidecars]
prefixes = ["meeting"]
```

```js
planner.on('page.section', ({ date, sidecars }) => {
  // `sidecars` is which of *your* files exist on that day. Never anybody
  // else's, and you are not told that anybody else's exist.
  return [
    { suffix: 'meeting-standup' },                                 // a block to type in
    { suffix: 'meeting-1-1-with-priya', title: '1:1 with Priya' },  // an offer of one
  ]
})
```

A suffix that exists is a block; one that does not is an offer, and needs a
`title` to write on it. A suffix outside your prefixes is dropped, and a line
in the day's notice band says how many. Twelve blocks per day, per plugin.

**You do not write the file.** Pressing the offer is what creates it, with the
title as its first line, and every keystroke after that is written by the app —
800 milliseconds after the last one, and on blur. A change arriving from
elsewhere is held while the block has the caret and applied when it leaves.

The title of a file that exists comes from the file's own first `# ` line, not
from your answer: you name a note once, and after that it is somebody's writing.

### `item.action`

A gesture on a line, and a page of your own about it:

```toml
slots = ["item.action", "item.badge", "page.section"]

[action]
label = "Notes"

[sidecars]
prefixes = ["note"]
```

`label` is what the ⌘, pane calls your gesture, beside the tick that grants
it. `⌘⇧N` on a focused line asks you, and this version asks **one** plugin: if
two are ticked for `item.action` it says so and opens nothing, rather than
choosing for you.

```js
// host -> plugin
{ kind: 'item.action', now, date: '2026-09-02', index: 3, text: 'Review PR #4412' }
// plugin -> host
{ open: 'sidecar:2026-09-01/note-review-pr-4412' }
```

Answer with `open` — a `sidecar:` of yours to show, created if it is not
there — or `null` when the line means nothing to you. Nothing else in this
version: an action that changes the line is not something this API does.

**Where a note may be made.** The app makes a file only when the ref's date is
**the page being drawn**, which is the `date` in the question. A ref for any
other day has to name a file that is already there; the app goes to that day
and shows it. So a note you have written stays where you wrote it, and nothing
you name can put a file in the vault on a day nobody is looking at.

**Declare `page.section` too.** Sections are drawn only from `page.section`
answers. A plugin that opened a note it could not list would show it once and
lose it on the next draw.

**A line has no identity, and this is the part to think about.** A line is a
position and some words. The position moves under any edit above it, and
carry-forward copies the words onto a new date every morning. So key a note on
the *words*, and look back: list your sidecars for the window you care about
in one call, and find the newest one on or before the question's `date`. That
is what `task-notes` does, and why a line carried forward for a fortnight
still carries its marker. Editing the words orphans the marker; the file stays,
named for what the line said.

The chord itself can cause the same orphan. It reads the line as it stands on
screen, half-typed word and all — right for what it shows you, and the words
you keyed the note on. Press `⌘⇧N` before a word is finished and finish typing
afterwards, and the committed line no longer kebabs to the suffix your note was
made under: the marker is gone, the same way an edit made afterwards orphans
one. Nothing is lost — the file is still there, findable by `⌘F` — but the line
and the note it named stop agreeing the moment either one keeps changing after
the other stopped.

### `search.provide`

```toml
slots = ["search.provide"]
```

```js
planner.on('search.provide', ({ query }) => [
  { text: 'Daryoush wants the retry to back off', date: '2026-09-01', href: 'sidecar:2026-09-01/meeting-standup' },
])
```

Asked 150 milliseconds after the last keystroke — one question per pause, not
one per keystroke — and never waited for: the vault's own results are on screen
before you are asked, and yours appear under them when they arrive. Your group
is headed by your plugin's name, and a provider with nothing has no group.

`text` is one line, cut at 200. `date` is optional and jumps to that day.
`href` is optional, must be a `sidecar:` of yours, and a hit whose href is
neither is dropped whole — a result you cannot press would not say why.
Twenty hits each.

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
and the `job` slot. Each arrives when something needs it. A slot with no
consumer is a guess about an API.
