# Suppress disconnect warning while accept is in progress

## What changed

In `EvolveSessionView.tsx`, the disconnected-server warning banner (`"⚠️ The preview server disconnected unexpectedly. The branch still exists."`) is now hidden when `status === "accepting"`, in addition to the existing suppression for `"accepted"` and `"rejected"`.

## Why

When the user clicks Accept and the accept runs asynchronously (the common blue/green production flow), the session transitions to `"accepting"` while the server performs pre-accept gates and the blue/green swap. As part of this process the preview dev server is killed, which sets `devServerStatus` to `"disconnected"`. Since `"accepting"` was not in the exclusion list, the warning banner would appear while the accept was in progress — even though the disconnect was intentional. Adding `"accepting"` to the exclusion list suppresses this spurious warning.
