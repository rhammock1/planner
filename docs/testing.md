# Testing

Almost everything in this app is tested without launching it. What is left is
the part that only an operating system can answer for.

## What runs on its own

```bash
npm test          # node --test over test/*.js
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
PLANNER_HOME=/tmp/planner-home npm run app
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

**Windows**

- [ ] The pinned page can be dragged by its header and stays where it is put.
- [ ] The page can be resized, and the list scrolls inside whatever size it
      has.
- [ ] `⌘↩` opens the second window, and the footer's tabs switch it.

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
