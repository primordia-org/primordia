# Delete duplicate rollback API route

## What changed

Removed `app/api/rollback/route.ts` (the `GET /api/rollback` and `POST /api/rollback` endpoints).

Also updated:
- `scripts/rollback.ts` — updated its comment to reference `/api/admin/rollback` instead of the now-deleted `/api/rollback`
- `AGENTS.md` — removed the old route from the file map and updated the `scripts/rollback.ts` description

## Why

There were two separate API routes that performed rollbacks:

| Route | File |
|---|---|
| `GET/POST /api/rollback` | `app/api/rollback/route.ts` |
| `GET/POST /api/admin/rollback` | `app/api/admin/rollback/route.ts` |

The `/api/rollback` route only supported rolling back to the immediately previous slot (hardcoded to `historyBranches[1]`). The `/api/admin/rollback` route is strictly more capable — it lists all previous production slots and lets the admin roll back to any of them.

The `AdminRollbackClient` component already used `/api/admin/rollback` exclusively. The old `/api/rollback` route had no UI consumers and was dead code.

Keeping one well-tested endpoint reduces surface area and avoids confusion about which route to use.
