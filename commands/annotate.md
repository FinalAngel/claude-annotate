---
description: Open a localhost page with drawing and note tools; what you mark comes straight back into this session
argument-hint: <url> [--poll] | pull | clear | close
---

The user wants to give visual feedback on a running page. Arguments: `$ARGUMENTS`

**Keep the mechanics out of the terminal.** No talk of injecting, screenshots,
Playwright, channels or tools. Two lines at most while opening, then silence
until something arrives.

## Dispatch on the argument

- `pull` → call `annotate_pull` and handle what it returns like a channel event (see below). If it says empty, tell the user to hit Send on the page.
- `clear` → call `annotate_clear`, confirm in one line.
- `close` → call `annotate_close`, confirm in one line.
- A URL (optionally with `--poll`) → call `annotate_open` with that url and `delivery: "poll"` only if `--poll` was given. Then say one line: the page is open, draw and drop notes, hit **Send to Claude** when ready. Then stop.
- Nothing → ask for the URL in one line.

## When annotations arrive

They come either as a `<channel source="…annotate" …>` event (normal) or as the
result of `annotate_pull` / `annotate_wait` (poll mode or safety net). Both have
the same shape: pages, numbered notes with the user's text and the element under
the pin (selector, text, React components, source file when known), marks
(strokes, arrows, lines, boxes, circles) with what they point at, and PNG paths.

1. `Read` every PNG path listed. Crops first, the full-page overview for context.
2. Say one short line: what you're going to change.
3. For each note in order: `annotate_progress(note, "working")`, make the change
   in the code, then `annotate_progress(note, "done", <one short line>)`. If a
   note can't or shouldn't be done, `annotate_progress(note, "skipped", <why>)`.
4. Marks without a note describe what they point at. Act on them too.
5. If the dev server hot-reloads, you may call `annotate_screenshot` to check.
6. Finish with `annotate_done(summary)`: one or two sentences. This shows on the
   page and deletes the temporary screenshots.
7. One short closing line in the terminal.

Use `annotate_reply` for a question you can't resolve yourself; it shows as a
toast on the page. Prefer a sensible assumption over a question.

## Poll mode only (`--poll`)

After `annotate_open`, call `annotate_wait` right away. When it returns a batch,
handle it as above, then call `annotate_wait` again. If it returns `timeout`,
call it again. If it returns `closed`, stop and say so.

## If Send never arrives

If the user says they hit Send and nothing came in, call `annotate_pull`. If
that returns a batch, the session was started without the channel flag: handle
the batch, then tell the user once to restart with
`claude --dangerously-load-development-channels plugin:annotate@claude-annotate`
or to use `/annotate <url> --poll`.
