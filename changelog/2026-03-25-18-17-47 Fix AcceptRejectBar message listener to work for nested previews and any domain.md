# Fix AcceptRejectBar message listener to work for nested previews and any domain

## What

Removed two overly restrictive checks from the `postMessage` listener in `AcceptRejectBar.tsx`:

1. **Removed `if (isPreviewInstance) return;`** — This guard prevented the listener from running inside a previewInstance, meaning previews spawned by other previewInstances (nested previews) could never trigger a restart in their parent. Any instance can now act as a parent and listen for accepted child previews.

2. **Removed the `localhost`/`127.0.0.1` hostname check** — This blocked the listener from working on deployed domains such as `primordia.exe.xyz`. Since the message type is specific (`primordia:preview-accepted`) and the triggered action (calling `/api/evolve/local/restart`) is harmless when called from a non-local context, the origin restriction is unnecessary.

## Why

The feature needs to work in two scenarios that the previous checks explicitly excluded:
- A previewInstance opening its own child preview (nested preview workflow).
- The app running on a custom domain (e.g. `primordia.exe.xyz`) rather than localhost.
