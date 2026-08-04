# Separate diagnostics dismiss controls

Server Health now treats captured diagnostics as separate CPU usage and memory leak issues instead of one combined CPU/memory warning. Each active issue gets its own card, notification-bell label, and investigate/fix thread prompt focused on that category.

Admins can also dismiss each captured diagnostics issue from Server Health. Dismissals are tracked per diagnostics capture and category, so dismissed issues stop appearing in alerts until a newer diagnostics bundle is captured.

The typecheck script now uses a small wrapper that emits heartbeat output while `tsc --noEmit` is running and reports recent kernel OOM-killer evidence if TypeScript exits via SIGKILL/137. This prevents silent typecheck phases from being mistaken for a hung command and makes it clear when failures are or are not caused by the OOM killer.
