# Installing annotate (for an agent)

You are setting up the **annotate** Claude Code plugin for the person you work for. Follow these steps in order and report what you verified.

## 1. Check the machine

- Claude Code 2.1.288 or later: `claude --version`
- Node 20 or later: `node --version`
- Google Chrome installed at the usual place (`/Applications/Google Chrome.app` on macOS). Edge works with `ANNOTATE_BROWSER=msedge`.

No Playwright browser download is needed. The plugin drives the installed Chrome with its own profile.

## 2. Add the marketplace and install the plugin

Inside a Claude Code session:

```text
/plugin marketplace add FinalAngel/claude-annotate
/plugin install annotate@claude-annotate
```

Choose **user** scope when asked, so it's available in every project. If the marketplace was cloned locally instead, pass the directory: `/plugin marketplace add /path/to/claude-annotate`.

The first `/annotate` runs `npm ci` inside the plugin directory to fetch the two dependencies. That takes a few seconds once.

## 3. Start the session with the channel flag

Exit Claude Code and start it again with:

```sh
claude --dangerously-load-development-channels plugin:annotate@claude-annotate
```

Claude Code shows a full-screen notice about development channels. Pick "I am using this for local development". After the banner a dim line must say that messages from `plugin:annotate@claude-annotate` inject into this session.

If the line says **blocked by org policy**, an admin has to enable channels for the organization (claude.ai → Admin settings → Claude Code → Channels). Until then use `/annotate <url> --poll`, which needs no flag.

Suggest an alias for the person, for example in their shell profile:

```sh
alias claude-annotate='claude --dangerously-load-development-channels plugin:annotate@claude-annotate'
```

## 4. Verify

With a dev server running, in the session:

```text
/annotate http://localhost:3000/
```

Expected: a Chrome window opens on that URL with a floating toolbar at the bottom and a green dot on the hand icon. Press `N`, click anywhere, type a word, press `↵`, then click **Send to Claude**. The session should receive a channel event within a few seconds and Claude should read a PNG path from it. The page shows a toast "Sent 1 note. Claude is on it."

If the toast says "If Claude doesn't react, type /annotate pull", the channel is not active in this session: go back to step 3.

## 5. Clean up

`/annotate close` closes the window. Temporary screenshots are removed when Claude calls done, on Clear, and when the session ends. The Chrome profile stays in `~/.cache/claude-annotate/chrome-profile/` so logins persist; delete it to reset.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/annotate` says it cannot launch chrome | No Chrome at the standard path, or the shared profile is locked by a crashed window | Install Chrome or set `ANNOTATE_BROWSER`; kill stray `Google Chrome` processes whose arguments contain `claude-annotate/chrome-profile` |
| `/mcp` shows the annotate server as failed | `npm ci` failed or Node is too old | Run `cd <plugin dir> && npm ci` by hand and read the error |
| Marks drawn but Send does nothing | The bridge is unreachable (red dot on the toolbar) | Restart the session; the server and the overlay share one process |
| Progress never shows on the page | Claude is not calling `annotate_progress` | Remind it: the `/annotate` command and the server instructions describe the protocol |
