# ANSI escape log renderer for deploy section

## What changed

### New component: `components/AnsiRenderer.tsx`

A React component that parses and renders terminal output containing ANSI escape codes as properly styled HTML. Handles the subset of codes used by `scripts/install.sh`:

- **SGR sequences** (`\033[...m`) — colors (red/green/yellow/cyan), bold, dim, reset
- **Carriage return** (`\r`) — go to start of current line, enabling in-place overwrite (spinner animation)
- **Erase to end of line** (`\033[K`) — clears from cursor to end of line (used by `_done` to replace the spinner line with the completion line)
- **Newline** (`\n`) — advance to next line

The component uses a virtual-terminal model: it applies every `\r` and `\033[K` sequence to an internal character grid so that intermediate spinner frames are collapsed into their final state. The resulting `RenderedLine[]` array is then rendered as styled `<span>` elements.

Since install.sh output is streamed live as it arrives, each `\r`-overwrite update renders quickly enough without needing a separate React-side spinner animation. The component simply renders the current accumulated state of each line.

### `scripts/install.sh` — new `REPORT_STYLE=ansi` mode

Previously the installer had two modes:
- `REPORT_STYLE=plain` — no colors, no spinner (used when piping output to the UI)
- tty / `/dev/tty` detected — full ANSI colors + spinner

A new `REPORT_STYLE=ansi` mode forces ANSI colors and the spinner even when stdout is not a tty (i.e. when piped to Node.js). This is done by extending the color-variable setup condition:

```bash
elif [[ "${REPORT_STYLE:-}" == "ansi" ]] || [[ -t 1 ]] || [[ -e /dev/tty ]]; then
```

The existing `_step` and `_done` functions already skip `plain` mode and use the full spinner for everything else, so no changes are needed there.

### `app/api/evolve/manage/route.ts` — use `REPORT_STYLE=ansi`

Both `install.sh` spawn calls (in `runAcceptAsync` and `retryAcceptAfterFix`) were changed from `REPORT_STYLE: 'plain'` to `REPORT_STYLE: 'ansi'`. This means the install script now sends its full colored, animated output to the log stream.

### `app/evolve/session/[id]/EvolveSessionView.tsx` — use `AnsiRenderer` in deploy section

The deploy section previously joined `log_line` event contents with `\n` separators and displayed them in a `<pre>` tag. This was correct for plain-text output but would show raw escape codes for ANSI output.

Two changes:
1. **Concatenation**: `log_line` contents are now joined verbatim (`''` separator) instead of `'\n'`. This preserves the `\r` and `\033[K` sequences the ANSI parser needs.
2. **Rendering**: All four deploy sub-states (running, error, interrupted, success) now use `<AnsiRenderer text={rawLog} isActive={...} />` instead of `<pre>` tags.

### New test page: `/ansi-test`

An interactive test page at `/ansi-test` (modelled after `/markdown-test`) for exercising the `AnsiRenderer` component:

- **Sample picker** — five pre-baked samples: static lines, spinner→done sequences, a full install.sh simulation, an error/diagnostics scenario, and plain text with no ANSI codes
- **Raw input textarea** — shows the current input with `ESC` rendered as `␛` and `\r` as `␍`; editable so you can paste or type any raw sequence
- **Simulate stream** — replays the current input character-by-character at a configurable speed (0–200 ms/char) to verify `\r` spinner overwrite behaviour live
- **Side-by-side layout** — raw input on the left, rendered output on the right in a card that matches the deploy section style from `EvolveSessionView`

## Why

The "Deploying to production" experience in the UI was notably worse than running `./install.sh` in a terminal: no colors, no spinner animation, no visual distinction between step starts and completions. The plain-text mode was a workaround because the log display couldn't handle escape codes.

By building a focused ANSI renderer component — one that only handles the specific codes install.sh actually emits — we get the native terminal experience in the browser: green checkmarks for completed steps, cyan arrows for info, yellow warnings, animated spinners for in-progress steps, and dim text for diagnostic output.
