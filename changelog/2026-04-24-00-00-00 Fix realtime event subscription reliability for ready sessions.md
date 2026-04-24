# Fix realtime event subscription reliability for ready sessions

## What changed

- **`app/api/evolve/stream/route.ts`**: `isTerminal()` no longer treats `'ready'` as a terminal state. The SSE stream now stays open for `'ready'` sessions, closing only when status reaches `'accepted'` or `'rejected'`. This allows the stream to relay any new NDJSON events that arrive after the session first becomes ready (e.g. conflict-resolution runs, deploy steps).

- **`app/evolve/session/[id]/EvolveSessionView.tsx`** — three client-side fixes:
  1. The initial mount effect no longer skips `startStreaming()` when `initialStatus === 'ready'`. Pages loaded on an already-ready session now subscribe to future events immediately.
  2. The `visibilitychange` handler no longer treats `'ready'` as terminal, so streaming restarts correctly when the tab regains focus for a ready session.
  3. `handleUpstreamSync()` now calls `startStreaming()` after a successful merge response, ensuring any NDJSON events written during conflict resolution are picked up right away even if the stream had previously lapsed.

## Why

When a session was in `'ready'` state the SSE stream was closed (server closed it because `'ready'` was treated as terminal). Any subsequent server-side NDJSON writes — most notably the `conflict_resolution` agent run that `upstream-sync` triggers when a merge has conflicts — were invisible to the client until the page was reloaded.

Keeping the stream open for `'ready'` sessions costs almost nothing (the server just polls the NDJSON file every 500 ms and sends nothing when there are no changes) while ensuring all future state transitions are delivered without requiring a page reload.
