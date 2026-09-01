# The plugin API

A contract, like [format.md](format.md). What is written here is what a
plugin may rely on; anything else it can reach today, it may not be able to
reach tomorrow.

If it does not fit on a ruled page, it belongs in a plugin. That is the rule
this API exists to serve, and the reason it is small.

## A plugin is a folder

```
~/.planner/plugins/macos-calendar/
  manifest.toml
  index.js
```

```toml
# manifest.toml
name = "macos-calendar"
version = "0.1.0"
description = "Shows the day's events under your list"
entry = "index.js"
slots = ["vault.contribute"]

[permissions]
capabilities = ["macos.calendar.read"]
```

`entry` is the file the plugin starts at, relative to its own folder. A path
that climbs out of it is refused.

## Turning one on

Nothing runs because it was installed. `config.toml` decides:

```toml
[plugins.macos-calendar]
enabled            = true
approved_capabilities = ["macos.calendar.read"]
```

**The manifest is the ceiling.** A capability approved here that the manifest
does not ask for is not granted, and says so on the page. A capability the
manifest asks for that is not approved here is not granted either — the
plugin still runs, and finds out when it asks.

A settings pane is coming; until it does, this file is the only way in.

## The API

```js
// Supply lines for a range of days. The one slot there is.
planner.onContribute(({ from, to }) => [
  { date: '2026-09-01', time: '09:30', text: 'Standup' },
])

// Reach something native. Refused unless it was granted.
const events = await planner.capability('macos.calendar.read').events({ from, to })
```

`plugins/planner.d.ts` in the repo says the same thing in types, and the
reference plugin is checked against it.

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

## What is stopping you

Worth knowing, because it explains the shape of everything above.

A plugin runs in its own hidden webview at `plugin://<name>/`, served only
from its own folder. It has no core permissions, so it cannot listen for or
emit any of the app's events. It may call exactly one command,
`plugin_message`, and every message through it is checked against the
capabilities the manifest and the config both agreed on. It cannot reach the
network: `connect-src 'none'`, so `fetch`, `XMLHttpRequest` and websockets
are all closed. Whatever it needs from outside, it asks for as a capability.

Every question has a two-second deadline. A plugin that throws, hangs,
overruns, asks three times for something it was never granted, or answers a
question put to a different plugin, is put away for the session with a line
on the page saying so. The day page never waits for a plugin: it draws
without contributions and again if they arrive.

## Not in v1

`onRender`, `planner.storage`, `planner.vault.read`, `net.fetch`, `fs.read`,
the `job` slot, and the `item.badge` and `page.section` slots. Each arrives
when something needs it. A slot with no consumer is a guess about an API.
