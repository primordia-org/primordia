# Fix Codex websocket close classification

Codex runs that had already reported a completed turn could sometimes end with a benign shutdown message from the underlying websocket transport: `WebSocket closed 1006 Connection ended`. The worker treated that late close as a failed agent run, causing otherwise successful Codex responses to show as errored.

The Codex worker now tracks whether the turn completed successfully and suppresses that specific late websocket-close message. If Codex exits non-zero only because of this benign post-completion close, the run is recorded as successful. Real Codex failures, timeouts, aborts, and non-benign stream errors still surface as errors.
