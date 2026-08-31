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
-   Project toolchain - `node --test`, TypeScript as a checker only, no build step, zero runtime dependencies
