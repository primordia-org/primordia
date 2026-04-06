# Remove preview disconnect warning banner

## What changed

Removed the yellow warning banner in `EvolveSessionView` that appeared when the preview dev server disconnected unexpectedly. The banner displayed the message "⚠️ The preview server disconnected unexpectedly. The branch still exists." and included a duplicate "↺ Restart preview" button.

## Why

The "↺ Restart preview" action is already available in the **Available Actions** panel, making the separate warning banner redundant. Removing it reduces visual noise and avoids having two places to trigger the same restart action.
