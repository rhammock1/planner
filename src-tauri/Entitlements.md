# Why `Entitlements.plist` exists, and why it has no comments in it

The bundle is signed with `--options runtime` (`tools/rebuild`). Without the
hardened runtime the executable is not dyld-restricted, so anything running as
this user can `DYLD_INSERT_LIBRARIES` its way into a process that holds the
calendar and location grants and read both with no prompt.

The other half of that rule is this file. Under the hardened runtime, macOS
refuses the two resources below unless the signature names them — and it
refuses them **silently**:

```
locationd: Client has supported the hardened runtime but doesn't have the
           entitlement, not sending #AuthPrompt message to #CoreLocationAgent
```

The ask returns, `authorizationStatus` stays `NotDetermined` forever, no prompt
is ever drawn, and from inside the app it looks exactly like a plugin quietly
answering nothing. It is the same symptom an unsealed `Info.plist` gives, from
a different cause, and invisible from the app either way. This shipped for a
day between adding `--options runtime` and finding it in `locationd`'s log.

| Key | For |
|---|---|
| `com.apple.security.personal-information.location` | `macos.location.read` — sunrise arithmetic, to two decimal places |
| `com.apple.security.personal-information.calendars` | `macos.calendar.read` — the day's events, under the list |

Both are *resource-access* entitlements. They say which permissions the app may
be asked about; they do not weaken the runtime, and in particular they do not
restore library validation or the dyld environment variables it exists to take
away.

**The plist itself must stay comment-free.** `codesign` hands it to AMFI, whose
parser is stricter than a normal plist reader and stops at the first `<!-- -->`:

```
Failed to parse entitlements: AMFIUnserializeXML: syntax error near line 6
```

Which is why this is a separate file rather than a comment block at the top of
that one.

`tools/rebuild --bundle` checks the signed result for the location entitlement
and says so, next to the line about the sealed plist — the two failures look
identical from the app, so both are asserted where they are made.
