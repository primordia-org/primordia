# Show red error panel when deploy fails instead of green success

## What changed

In `app/evolve/session/[id]/EvolveSessionView.tsx`, the `deploy` section renderer now checks whether the `result` event has `subtype === 'error'` or `subtype === 'timeout'` before deciding how to style the finished state.

**Before:** Any completed deploy section (i.e. one that is no longer actively running) was always rendered with the green "🚀 Deployed to production" banner, regardless of whether the deploy actually succeeded or failed.

**After:** If the deploy's `result` event has an error or timeout subtype, the section renders a red "❌ Deploy failed" panel instead, showing the error message from the result event (e.g. "Accept failed (unexpected error): install.sh exited with code 1"). The deploy log is still shown in a collapsible `<details>` block, now styled in red. The green success banner is only shown when the deploy genuinely succeeded.

## Why

When `scripts/install.sh` exits with a non-zero exit code (e.g. due to a Bun crash, build failure, or SIGILL), the session page was misleadingly reporting "🚀 Deployed to production" at the top of the deploy section while the actual error message was buried in the progress log. This was confusing — users would see a green success header but the app had not actually been deployed.
