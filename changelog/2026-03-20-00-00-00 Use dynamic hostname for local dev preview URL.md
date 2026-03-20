# Use dynamic hostname for local dev preview URL

## What changed

- `components/EvolveForm.tsx`: When a local evolve session reaches the `ready`
  state, the preview URL is now constructed client-side as
  `${window.location.protocol}//${window.location.hostname}:${port}` instead of
  the hardcoded `http://localhost:${port}`.  The `LocalEvolveSession` interface
  gained a `port: number | null` field to support this.
- `lib/local-evolve-sessions.ts`: The progress-log message that previously said
  `Ready at http://localhost:{port}` now says `Ready on port {port}` to avoid
  embedding a localhost URL in text that could be copied from a remote machine.

## Why

When Primordia's dev server runs on a remote machine (e.g. `primordia.exe.xyz`)
and the developer accesses it via a forwarded or public hostname, the old
`http://localhost:{port}` preview link would resolve to the developer's own
machine rather than the remote host. Using `window.location.hostname` makes
the link work correctly regardless of whether the session is truly local or
accessed remotely.
