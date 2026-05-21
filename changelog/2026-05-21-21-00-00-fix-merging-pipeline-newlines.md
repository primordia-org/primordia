# Fix Dev Server Merging Pipeline Output Row Formatting

## Description
When executing the faster development pipeline accept flow (where `NODE_ENV !== 'production'`), progress lines indicating `- Merging branch…` and `- Installing dependencies…` were written to the session log using `step(...)`. Since `step(...)` is mapped to `appendLogLine`, which appends logs verbatim to the NDJSON stream, these messages were emitted without a trailing newline character `\n`.

Because the client-side `AnsiRenderer` processes lines sequentially and relies on explicit boundary markers or newline characters to distinguish separate console lines, sequential log entries written without a trailing newline ended up rendered on a single conjoint row (e.g., `- Merging branch…- Installing dependencies…`).

This has been resolved by appending active newlines to each string in these accept step logging commands inside `app/api/evolve/manage/route.ts`.

## Changes Made
- Modified `- Merging branch…` step output in `app/api/evolve/manage/route.ts` to `- Merging branch…\n`.
- Modified `- Installing dependencies…` step output in `app/api/evolve/manage/route.ts` to `- Installing dependencies…\n`.
