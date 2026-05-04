# Move Restart Preview Button to Preview Server Section

## What changed

The "↺ Restart preview" / "▶ Start preview" button has been moved from the **Available Actions** panel header into the **Preview server** section header, where it sits alongside the server status indicator.

The `restartError` message is now displayed inside the Preview server section (below the header) instead of in the Available Actions panel.

The Server logs `<details>` section is now always rendered when the session is `ready` (previously it was hidden entirely when `serverLogs` was an empty string). An empty state message "No logs yet…" is shown until the proxy stream delivers content. This prevents the section from visually disappearing after a restart clears the accumulated log buffer.

## Why

The restart button is directly related to the preview server's state — it controls starting and restarting that server. Placing it next to the server status text makes the UI more discoverable and logically grouped: everything about the preview server (status, URL, restart control, logs) lives in one place. The Available Actions panel is reserved for higher-level session actions (follow-up, accept, reject, abort).

The always-visible Server logs fix was prompted by the button relocation: with the restart control now prominently in the Preview server section, users restart more readily, which clears the `serverLogs` state and previously caused the entire section to vanish until new logs arrived.
