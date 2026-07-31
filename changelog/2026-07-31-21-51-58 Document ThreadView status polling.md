# Document ThreadView status polling

ThreadView now includes an in-page explanation next to the Web Preview panel that exhaustively lists why it polls preview server process status every two seconds.

The list clarifies that preview server state can change independently of thread session events: lazy reverse-proxy starts, asynchronous restarts, crashes, external CLI/admin actions, deploys, follow-ups, upstream updates, DB hotswaps, and UI affordances like iframe overlays, restart controls, and automatic log opening all require fresh process-status checks.
