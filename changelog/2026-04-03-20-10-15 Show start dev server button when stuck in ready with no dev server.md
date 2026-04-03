# Show "Start preview" button when stuck in ready with no dev server

## What changed

In `EvolveSessionView.tsx`, the "Restart preview" button was only shown when
`status === "ready"` **and** `devServerStatus` was neither `"none"` nor
`"starting"`. This meant the button was hidden when the session ended up in
`ready` with `devServerStatus === "none"` and no port or preview URL yet set.

The condition is now relaxed to show the button whenever `status === "ready"`
and `devServerStatus !== "starting"`. When `devServerStatus === "none"` the
button label reads **"▶ Start preview"** (spinner text: "Starting…");
otherwise it keeps the existing **"↺ Restart preview"** / "Restarting…" labels.

All "Restart dev server" button labels were also renamed to "Restart preview" for
consistency. The server logs disclosure triangle icon was changed from 📋 to 🪵.

## Why

When Claude Code crashes mid-session and the user aborts it, the session
transitions directly from `running-claude` → `ready` without ever spawning the
dev server (`devServerStatus` stays `"none"`). Previously this left users
stranded — no preview, and no button to start one. The underlying
`/api/evolve/kill-restart` route already handles a `null` port gracefully, so
reusing it here required only a UI condition change.
