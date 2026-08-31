# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A note to self: search `[^#.-:].\[` to find all the entries without punctuation.

## [Unreleased]

### Added

-   Markdown vault format - one file per day plus a `someday.md` back page, with item states `[ ]` `[x]` `[>]` `[-]`, inline `@time` `!due` `~lead` `>moved` tokens, per-item notes and a daily note
-   Lossless parsing - any line the parser does not recognise is preserved byte-for-byte, so a hand-edited file can hold anything without risk
-   Round-trip guarantee - reading and writing a canonical file returns it unchanged, and a non-canonical file is normalised once and then holds steady
-   YAML frontmatter is preserved and never interpreted, so a vault opened in Obsidian keeps parsing correctly
-   `tools/dump.js` for inspecting a vault file - parsed structure, canonical rewrite, or a round-trip check
-   `docs/format.md` publishing the vault format as a contract
-   An in-memory index over the vault, keyed by day or `someday`, mapping page keys to file paths and back
-   The horizon strip's rules - an item enters when its due date falls inside its lead time, overdue items sort first, and nothing ages out until it is dealt with
-   Carry-forward - unfinished items from past days are kept or dropped, and today is written first so a failed write can only duplicate an item, never lose one
-   Natural-language entry - `tomorrow`, weekday names, `in 3 days`, `9/2`, `sep 2`, `8:40`, `4pm`, `at 4`, and `by friday` or `due sep 2` for deadlines
-   UTC calendar arithmetic, so no date shifts under a daylight saving transition
-   Project toolchain - `node --test`, TypeScript as a checker only, no build step, zero runtime dependencies

### Fixed

-   A daily-note rule with nothing after it is no longer deleted on save - a file ending in `---` lost one rule per save until none were left
-   Files with CRLF line endings now parse their items instead of reading as an empty day
-   A leading blank line or byte-order mark no longer demotes a day file to the back page
-   Tabs, non-breaking spaces and repeated spaces inside item text are preserved instead of collapsed to a single space
