# Hide disconnect message for accepted or rejected sessions

## What changed

The "⚠️ The preview server disconnected unexpectedly. The branch still exists." warning
in `EvolveSessionView` is now hidden when the session status is `accepted` or `rejected`.

## Why

When a session is accepted or rejected, the worktree and branch are deleted as part of
the merge/discard process. The dev server exits as a side effect of that cleanup, which
triggered the `disconnected` dev server status. This caused the misleading warning to
appear on completed sessions — claiming the branch still exists when it has actually
already been deleted.

The fix adds `status !== "accepted" && status !== "rejected"` guards to the disconnect
notice render condition so it only shows for sessions where the branch is genuinely
still present.
