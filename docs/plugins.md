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
version     = "0.1.0"
description = "Opens the ticket a line mentions"
entry       = "index.js"
slots       = ["item.badge"]

[permissions]
capabilities = ["shell.open"]

[permissions.open]
urls = ["https://github.com/org/repo/pull/"]
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
approved_open         = ["https://github.com/org/repo/pull/"]
```

**The manifest is the ceiling.** A slot, a capability or an address approved
here that the manifest does not ask for is not granted, and says so on the
page. Anything the manifest asks for that is not approved here is not granted
either — the plugin still runs, and finds out when it asks.

A settings pane is coming; until it does, this file is the only way in.

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

A badge's `label` is one line, cut at 16 characters. Its `index` must be one
the question sent — the lines may have moved while you were thinking, and a
marker against the wrong line is worse than no marker. One marker per line per
plugin.

`href` is opened by the app when somebody clicks the marker. Your plugin is
not asked anything at that point and does not run at all.

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

`status` is `confirmed`, `tentative`, `cancelled` or `none`. Deciding what to
do about a cancelled meeting is the plugin's job; the bridge has no opinion.

The first call after the plugin is enabled asks macOS for permission and
fails politely while the prompt is up. Open the popover again once you have
allowed it.

`events` may be asked about at most 62 days at a time. A wider range is
refused with an error rather than trimmed, because a plugin that asked for a
decade should find out that it did.

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
