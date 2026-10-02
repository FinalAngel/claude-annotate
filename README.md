<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img alt="annotate" src="assets/logo.svg" width="264" height="80">
  </picture>
</p>

<p align="center"><strong>Draw on the page. Claude fixes the code.</strong><br>A Claude Code plugin: mark up your running localhost site in the browser, hit <em>Send to Claude</em>, and every mark lands in the session that opened the page, with the element, its component and a screenshot under each one.</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-FF4D8D"></a>
  <img alt="Node 20 or later" src="https://img.shields.io/badge/node-%3E%3D20-FF4D8D">
  <img alt="Two dependencies" src="https://img.shields.io/badge/dependencies-2-FF4D8D">
  <img alt="Nothing leaves the machine" src="https://img.shields.io/badge/cloud-none-FF4D8D">
  <a href="https://github.com/FinalAngel/claude-annotate/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/FinalAngel/claude-annotate/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p align="center"><img alt="Demo. In Claude Code, /annotate http://localhost:5180/ opens the pricing page with the toolbar on it. A box, an arrow and a circle are drawn, two notes are typed, Send to Claude is pressed. Back in the terminal the batch arrives as a channel event and Claude reads the crop, edits content.tsx and reports progress per note. On the page the pins turn green with Claude's one-line results and the toolbar says All done." src="assets/demo.gif" width="1100"></p>

```text
/plugin marketplace add FinalAngel/claude-annotate
/plugin install annotate@claude-annotate
```

```sh
claude --dangerously-load-development-channels plugin:annotate@claude-annotate   # once per session, see "The channel flag"
```

```text
/annotate http://localhost:5180/
```

The page opens in its own Chrome window with the tools already on it. Pen, arrow, box, circle, numbered notes. Scroll, click through to other pages, keep marking. One Send. Claude reads the crops, edits the code, and each pin on the page reports back: spinning while Claude works on it, green with a one-line result, grey if skipped. **Clear** wipes it all and you go again.

## What Claude receives

One event per Send, pushed into the running session. This is the batch behind the screenshot above, as Claude saw it (paths shortened):

```text
Browser annotations · batch 1 · 1 page · 3 notes · 4 marks

## Page 1 of 1 — http://localhost:5180/
viewport 1440×900 · document 1440×7980
overview (full page, tall): /tmp/claude-annotate/5e1f2a9c/batch-1/p1-page.png

### Note 1 — "monthly should be the default"
crop: /tmp/claude-annotate/5e1f2a9c/batch-1/p1-crop1.png  (region 0,4167 → 1110×536)
pin at 666,4415 · pink
on: <button.ff-seg__tab[role=radio]>  "MONTHLY"  at 625,4397 size 82×36
in: div.ff-planpass__body > div.ff-planpass__top > div.ff-seg[role=radiogroup]
component: ToggleGroupItem ‹ ToggleGroup ‹ PlanPass ‹ Pricing ‹ SiteSection
source: src/screens/site/content.tsx:171
marks here: pink box around <div.ff-seg[role=radiogroup]> "MONTHLY YEARLY"; sun arrow → <div.ff-planpass__body> "KEEP THE LIGHTS ON MONTHLY YEARLY $…"; cyan stroke around <b.ff-num> "$5"

### Note 2 — "price feels too big, drop one size"
pin at 140,4519 · cyan
on: <b.ff-num>  "$5"  at 88,4485 size 95×77
component: PlanPass ‹ Pricing ‹ SiteSection ‹ SiteMain ‹ Landing
source: src/screens/site/content.tsx:135

### Note 3 — "arrow should sit in its own circle like the hero buttons"
crop: /tmp/claude-annotate/5e1f2a9c/batch-1/p1-crop2.png  (region 0,4670 → 1178×440)
on: <svg>  at 752,4883 size 14×14
in: div.ff-planpass__action > a.ff-btn.ff-btn--ghost > span.ff-btn__ic
component: Icon ‹ Link ‹ A ‹ Button ‹ ButtonLink
source: src/screens/site/content.tsx:45
marks here: lime box around <a.ff-btn.ff-btn--ghost> "BECOME A SUPPORTER"
```

Per note that is: your text, the element under the pin with its visible text and box, where it sits in the DOM, the React components it is rendered by (only the ones that appear in your own code, library internals are dropped), the file and line where that element is written, and the marks drawn near it with what each one points at. Nearby marks are clustered into one crop, so a note and the arrow next to it arrive in the same picture. The full-page overview is there for layout questions. On a page without React you still get the element, its text, the DOM path and the crops.

`source` comes from React's own development metadata (`_debugSource` on React 18, the owner stack on React 19). Vite and Next.js dev builds have it. Production builds don't, and then only the component names and DOM path are reported.

## On the page

<p align="center"><img alt="The same page after Claude finished. Pins 1 and 2 are green checks with a result line under each note: 'Monthly is the default now' and 'Price dropped one step on the scale'. Pin 3 is grey with 'Hero buttons use that circle for primary actions only'. A toast at the top reads Done with Claude's summary, and the toolbar button says All done." src="assets/done.png" width="1440"></p>

| | |
|---|---|
| **Marks** | Pen, arrow, box, circle. Four inks with a dark halo, so they read on light and dark pages. Hold `⇧` for a square or a circle. |
| **Notes** | `N` then click. Type, `↵`. Numbered across all pages. Click a pin to edit or delete. |
| **Browse** | `V` or `esc` passes clicks through to the page, so you can open a menu, change route, log in. Pins stay. |
| **Across pages** | Marks are stored per URL. Navigate away and back and they are still there. One Send covers every page. |
| **Select** | `S`, click a mark to select it, drag to move it, `⌫` to delete. Pins drag in any mode. `⌘Z` and `⇧⌘Z` for undo and redo. |
| **Send** | `⌘↵` or the button. It counts what hasn't been sent yet, so you can send, keep drawing, send again. |
| **Progress** | Pin spins: Claude is on that note. Green with a line: done. Grey: skipped, with why. The toolbar shows which file Claude is editing. |
| **Clear** | Two clicks (the second one says *Sure?*). Removes every mark on every page and the temporary screenshots. |

Keys: `P` pen · `A` arrow · `R` box · `E` circle · `N` note · `S` select · `1` – `4` inks · `V` / `esc` browse · `⌘Z` · `⇧⌘Z` · `⌫` · `⌘↵` send. Drag the toolbar by its grip, it remembers where you put it per site.

## Why not paste a screenshot

Pasting a screenshot and describing it works, and it is what this replaces. Each round costs a screenshot, a paste, and prose like "the second toggle in the pricing card, no, the other card". Claude then guesses which file that is. Here the prose is the note, the position is the pin, and the file and line come along for free. Browser tools in the same space, as of October 2026:

| Tool | Where you annotate | How it reaches Claude Code |
|---|---|---|
| **annotate** (this) | Its own Chrome window, any local site, drawing and notes | Pushed into the running session on Send; progress and results come back onto the page |
| [tomreinert/claude-annotate](https://github.com/tomreinert/claude-annotate) | A Playwright window, drawing only | Pushed into the session; a toast comes back |
| [browser-annotations](https://github.com/wiebekaai/browser-annotations) | A Chrome DevTools panel, pick an element, write feedback | Pushed into the session |
| [Agentation](https://github.com/benjitaylor/agentation) | A toolbar you mount in your React app | Claude polls an MCP server, or you paste |
| [Vibe Annotations](https://www.vibe-annotations.com/) | A Chrome extension on localhost pages | Claude polls an MCP server |
| [React Grab](https://github.com/aidenybai/react-grab) | `⌘C` on an element in your React app | Clipboard, you paste |

Everything that pushes into a running session uses Claude Code [channels](https://code.claude.com/docs/en/channels). Everything else waits to be asked. The first of those projects is where this one started, see [Credits](#credits).

## How it works

One Node process per session, spawned by Claude Code as an MCP server. It does three jobs:

1. **Browser.** On `/annotate <url>` it launches the Chrome you already have through `playwright-core`, with its own profile under `~/.cache/claude-annotate/`, and injects `plugin/server/overlay.js` into every page before the page's own scripts run. The overlay is a Shadow DOM on a host appended to `<html>`: the page's CSS never reaches it, and its CSS never reaches the page. Marks live in document coordinates, so they stay put while you scroll. No change to your app, no extension, no build step.
2. **Bridge.** The overlay talks to the process over a local HTTP port with a per-session token. State is kept per URL on the server, which is why navigation keeps your marks and a reload restores them. A `PostToolUse` hook posts the file Claude just edited, and tool results, toasts and the done summary stream back to the page over server-sent events.
3. **Channel.** On Send, the process screenshots every annotated page (pages that aren't open right now get rendered in a temporary tab), clusters nearby marks into crops, writes the PNGs to a temp dir, and pushes one `notifications/claude/channel` event into the session. Claude reads the files, edits the code, and calls `annotate_progress` per note and `annotate_done` at the end, which deletes the PNGs.

The overlay mounts on local development hosts only (localhost, 127.0.0.1, private IPs, `*.localhost`, `*.test`, `*.local`, `*.internal`) and takes the bridge token off the page before any page script runs, so a third-party site opened in that window never sees it. `annotate_open` refuses other hosts.

<p align="center"><img alt="Mid-batch: a toast says Sent 3 notes, Claude is on it. Pin 1 pulses with a spinning ring while the ticker above the toolbar reads working on note 1. The Send button has turned into a breathing Claude is on it." src="assets/working.png" width="1440"></p>

Tools the server exposes: `annotate_open`, `annotate_progress`, `annotate_done`, `annotate_reply`, `annotate_screenshot`, `annotate_pull`, `annotate_wait`, `annotate_clear`, `annotate_close`. The `/annotate` command tells Claude how to use them; the server's MCP instructions repeat the protocol so a channel event is handled even if you never typed the command in this session.

### The channel flag

Channels are a research preview in Claude Code. A plugin from your own marketplace can push into a session only when you start the session with

```sh
claude --dangerously-load-development-channels plugin:annotate@claude-annotate
```

Claude Code shows a full-screen confirmation once, then a dim line under the banner says messages from this plugin inject into the session. Alias the command. On Team and Enterprise plans an admin has to [enable channels](https://code.claude.com/docs/en/channels#enterprise-controls) for the organization first, and the flag does not get around that.

Without the flag everything still works except the push:

- `/annotate <url> --poll` makes Claude wait inside a tool call until you hit Send. Nothing is pushed, nothing is lost.
- `/annotate pull` fetches the last batch you sent, if Claude didn't react.

### What is written where

| Path | What | When it goes away |
|---|---|---|
| `$TMPDIR/claude-annotate/<session>/batch-N/*.png` | Crops and the full-page overview for one batch | When Claude calls done, on Clear, when the session ends. macOS purges what a crash leaves after three days |
| `~/.cache/claude-annotate/chrome-profile/` | The Chrome profile the annotation window uses (cookies, logins for your localhost apps) | Stays. Delete it to start fresh. A second concurrent session gets a throwaway profile that is removed on exit |
| `~/.cache/claude-annotate/sessions/<pid>.json` | The bridge port and token, so the hook can find its session | When the session ends; stale ones are pruned at startup |
| `localStorage` of the annotated site | Where you dragged the toolbar | Never, it's one key |

The bridge listens on `127.0.0.1` only and every request needs the session token. Neither the server nor the overlay makes an outbound connection.

## FAQ

**Does it change my app?** No. The overlay is injected by the browser automation layer, not by your bundler. Your source, your `index.html` and your build are untouched. Open the same URL in your normal Chrome and nothing is there.

**Does it work on a site that isn't React?** Yes. You get the element, its visible text, the DOM path and the screenshots. Component names and source lines are React-only, and only in development builds.

**What about a page behind a login?** The annotation window has its own Chrome profile that persists, so log in once. Claude's temporary tabs for other pages share the same profile.

**Claude didn't react to Send.** Type `/annotate pull`. If a batch comes back, the session was started without the channel flag: restart with it, or use `--poll` next time. The server cannot tell whether the flag was given, so the page can't warn you; the pull is the check.

**Two Claude Code sessions, two annotate windows?** Yes. Each session has its own server, port, token and batch directory. The second window gets a throwaway Chrome profile because Chrome allows one process per profile.

**Edge instead of Chrome?** `ANNOTATE_BROWSER=msedge`. With `ANNOTATE_BROWSER=chromium` it uses Playwright's bundled build after `npx playwright install chromium`. Edge is untested.

**Can Claude look at the page after fixing it?** `annotate_screenshot` returns the current state of the annotation window, so after the dev server hot-reloads Claude can check its own work. The command asks it to when that helps.

**Why Playwright and not the Claude in Chrome extension?** The extension gives Claude a browser; this gives *you* a surface to draw on and needs the overlay on every page, including the ones Claude opens in the background for screenshots. Driving Chrome directly makes that one line of code instead of a protocol.

## Development

```sh
cd plugin && npm install
npm test                                        # syntax, MCP handshake, bridge, hook, cleanup. No browser.
claude --plugin-dir ./plugin --dangerously-load-development-channels plugin:annotate@claude-annotate
```

`ANNOTATE_DEBUG=1` adds an `annotate_debug` tool that drives the browser (mouse, keys, eval, viewport), which is how the screenshots in this README were staged against a real app.

Layout: `plugin/server/index.mjs` is the whole server, `plugin/server/overlay.js` the whole overlay, `plugin/commands/annotate.md` what Claude does, `plugin/hooks/hooks.json` and `plugin/scripts/ticker.mjs` the file ticker. Two runtime dependencies: `@modelcontextprotocol/sdk` and `playwright-core`.

Not there yet: marks inside iframes, pages that scroll a wrapper instead of the window, attaching an image to a note, a mobile viewport preset, and a channel allowlisting so the flag can go.

To have an agent do the setup, point it at [INSTALL.md](INSTALL.md).

## Credits

Inspired by [tomreinert/claude-annotate](https://github.com/tomreinert/claude-annotate/), which showed that a Claude Code channel can carry a drawing from a live page into the running session. This one grew out of wanting the same thing with notes, element context, several pages and progress back on the page.

## License

[MIT](LICENSE)
