# Make typecheck progress visible

The typecheck script now uses a small wrapper that emits heartbeat output while `tsc --noEmit` is running and reports recent kernel OOM-killer evidence if TypeScript exits via SIGKILL/137.

This prevents silent TypeScript checking phases from being mistaken for a hung command and makes it clear when failures are or are not caused by the OOM killer.
