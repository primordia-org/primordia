# Refactor reverse proxy process helpers

The reverse proxy now statically imports the shared process manager instead of dynamically resolving and importing `lib/process-manager.ts` at runtime. Reverse-proxy process spawning, port cleanup, free-port selection, disk usage checks, and git runtime operations have been moved behind `lib/process-manager.ts` and `lib/git-runtime.ts` helpers so the proxy no longer uses `child_process` directly.

This keeps process and git orchestration behavior centralized, makes reverse proxy bundling/import behavior simpler, and reduces duplicated process-management code.
