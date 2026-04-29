# Style proxy spawn endpoint output like installer

## What changed

The `/_proxy/prod/spawn` SSE endpoint in `scripts/reverse-proxy.ts` now uses the same
`_step` + `_done` visual pattern as `scripts/install.sh`:

- **Before**: flat log lines like `- Starting new production server…` with a trailing
  newline, giving no feedback about when each step finished.
- **After**: each step starts with an in-progress line (no newline), then a green
  `\r✓ Done message` overwrites it on success — matching the installer's spinner/checkmark
  pattern exactly.

The three log steps are now:

```
Starting server…              ← overwritten by ↓
✓ Server started
Health-checking server…       ← overwritten by ↓
✓ Health-check passed
✓ Web traffic is now being directed to this server
```

ANSI colour codes (`\x1b[0;32m` / `\x1b[0m`) are included so the green `✓` renders in:
- **Web UI** — `AnsiRenderer` already handles these escape sequences.
- **Terminal** — `install.sh`'s SSE parsing now converts JSON-encoded `\u001b` to the
  actual ESC byte via a `sed` substitution before passing to `printf '%b'`, so the ANSI
  colour codes reach the terminal correctly.

## Why

The proxy spawn endpoint is called both during `Accept Changes` deploys and by
`install.sh` when updating an existing instance. The output was plain and hard to read.
Aligning it with the installer's visual style gives a consistent, polished deploy
experience in both the session progress view and the terminal.
