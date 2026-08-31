# The theme contract

**Version 1.**

A theme is a folder. Planner reads two files from it and nothing else:

    ~/.planner/themes/ledger/
      theme.toml     metadata and colour tokens
      theme.css      optional, for structural quirks
      *.woff2        optional, fonts the theme ships

The token names below are a published contract. New tokens may be added in a
minor version; a token is never renamed or removed except in a major one. A
theme that sets only some of them still renders — the rest come from Ledger.

## theme.toml

```toml
name       = "Ledger"
author     = "Robert Hammock"
appearance = "light"        # "light" or "dark"

[tokens]
paper       = "#FBFAF6"
surface     = "#F4F2EA"
edge        = "#D9D6CC"
edge-soft   = "#E7E4DA"
ink         = "#23262A"
dim         = "#8B8981"
accent      = "#17605B"
alert       = "#A8452C"
font-head   = "Newsreader, Georgia, serif"
font-body   = "Public Sans, system-ui, sans-serif"
font-meta   = "IBM Plex Mono, monospace"
radius      = "10px"
texture     = "radial-gradient(#E2DFD4 1px, transparent 1px)"
```

`appearance` drives the macOS window appearance and the page's
`color-scheme`. It is not a token; it says which of the two worlds the theme
lives in.

## The tokens

| Token         | What it paints                                                  |
|---------------|-----------------------------------------------------------------|
| `paper`       | The page itself — the surface everything sits on                 |
| `surface`     | Recessed bands: the horizon strip and the footer                 |
| `edge`        | The outer border, and any line meant to be seen                  |
| `edge-soft`   | Interior hairlines: between items, under the header              |
| `ink`         | Item text, the date, anything meant to be read                   |
| `dim`         | Times, dates, counts — present but not competing                 |
| `accent`      | The app's one colour: checkmarks, today, the active surface      |
| `alert`       | Overdue only. Nothing else may use it, or it stops meaning late  |
| `font-head`   | The date header                                                  |
| `font-body`   | Item text and notes                                              |
| `font-meta`   | Times, due dates, counts — anything that lines up in a column    |
| `radius`      | Corner radius, applied once and used everywhere                  |
| `texture`     | A background layer over `paper`: a gradient, a repeating image   |

Tokens reach the page as CSS custom properties on `:root`, named with a `--`
prefix: `paper` becomes `var(--paper)`.

## theme.css

Appended after the app's own stylesheet, for what tokens cannot express —
ruled lines, bracket checkboxes, a serif small-caps footer. It is CSS with no
sandbox: a theme can restyle anything. Read one before you install it.

## Fonts

Fonts must be files in the theme folder, referenced from `theme.css` by
`@font-face` with a relative `url()`. **Themes never touch the network.** A
token value that names a remote `url()`, imports a stylesheet, or contains
`{`, `}`, `;`, `<` or `>` is refused and the default is used instead — such a
value could otherwise close the rule it sits in and restyle the app from
outside its own scope.

## A theme of your own

Copy `themes/ledger/` to `~/.planner/themes/<name>/`, change the tokens, and
set `theme = "<name>"` in `~/.planner/config.toml`. Themes hot-reload: save
the file and the page repaints.
