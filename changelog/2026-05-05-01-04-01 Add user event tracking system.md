# Add user event tracking system

## What changed

### Database
- Added `events` table to SQLite (via `lib/db/sqlite.ts`) with schema:
  ```sql
  CREATE TABLE events (
    id      INTEGER PRIMARY KEY,
    ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    user_id TEXT,
    event   TEXT NOT NULL,
    props   TEXT  -- JSON blob
  ) STRICT;
  CREATE INDEX idx_events_ts    ON events(ts);
  CREATE INDEX idx_events_event ON events(event);
  CREATE INDEX idx_events_user  ON events(user_id);
  ```
- Added `appendEvent`, `queryEvents`, and `countEvents` methods to `DbAdapter` interface (`lib/db/types.ts`) and the SQLite adapter.

### API endpoint — `POST /api/events`
- Single write endpoint for all producers: browser, Next.js server code, agent workers.
- Open (no auth required) — session cookie is read automatically when present; callers can also pass `userId` explicitly for server/worker contexts without a session.
- Body: `{ event: string, props?: Record<string, unknown> | null, userId?: string | null }`
- Returns `{ id }` (the inserted row id) with status 201.

### API endpoint — `GET /api/events`
- Admin-only query endpoint used by the event log viewer.
- Query params: `limit`, `offset`, `event` (exact match filter), `userId` (exact match filter).
- Returns `{ rows, total, limit, offset }`.

### Client/server helper — `lib/events-client.ts`
- `trackEvent(event, props?)` — fire-and-forget browser helper (uses `keepalive: true` so requests survive page unload).
- `appendEvent(event, props?, userId?)` — async server/worker helper.
- Both silently swallow errors so tracking never breaks the UI or pipeline.

### Event naming convention
Versioned slash-suffix format, e.g.:
```
{ "name": "file-attachment-removed/v1",
  "props": { "source": "evolve/remove-file-attachment", "el": "button", "trigger": "mouse" } }
```

### Admin event log viewer — `/admin/events`
- New page `app/admin/events/page.tsx` + client component `EventsClient.tsx`.
- Paginated table (50 rows/page) showing: id, timestamp (UTC), event name, user id, props.
- Click any row to expand its props as pretty-printed JSON.
- Filter by event name and/or user ID; refresh button; prev/next pagination.
- Added "Events" tab to `components/AdminSubNav.tsx`.

### Instrumented components (follow-up)

After the initial infrastructure landed, all user-facing pages and components were instrumented with `trackEvent()` calls:

| Component / file | Events tracked |
|---|---|
| `components/EvolveRequestForm.tsx` | `evolve-form/submit/v1`, `evolve-form/submit-error/v1`, `evolve-form/files-attached/v1` (trigger: button/drag/paste), `evolve-form/file-removed/v1`, `evolve-form/element-removed/v1`, `evolve-form/attach-files-clicked/v1`, `evolve-form/element-inspector-opened/v1`, `evolve-form/element-picked/v1`, `evolve-form/advanced-toggled/v1`, `evolve-form/harness-changed/v1`, `evolve-form/model-changed/v1`, `evolve-form/caveman-toggled/v1`, `evolve-form/caveman-intensity-changed/v1` |
| `app/evolve/session/[id]/EvolveSessionView.tsx` | `session/accept-clicked/v1`, `session/reject-clicked/v1`, `session/abort-clicked/v1`, `session/upstream-sync-clicked/v1`, `session/restart-server-clicked/v1`, `session/force-reset-clicked/v1`, `session/action-panel-toggled/v1`, `session/branch-name-copied/v1` |
| `components/HamburgerMenu.tsx` | `nav/menu-toggled/v1`, `nav/menu-item-clicked/v1` (for all built-in and page-specific items) |
| `components/FloatingEvolveDialog.tsx` | `evolve-dialog/opened/v1` |
| `components/auth-tabs/passkey/index.tsx` | `auth/passkey-login-started/v1`, `auth/passkey-login-succeeded/v1`, `auth/passkey-login-failed/v1`, `auth/passkey-register-started/v1`, `auth/passkey-register-succeeded/v1`, `auth/passkey-register-failed/v1` |
| `components/auth-tabs/cross-device/index.tsx` | `auth/cross-device-qr-started/v1`, `auth/cross-device-approved/v1` |
| `components/QrSignInOtherDeviceDialog.tsx` | `auth/push-qr-started/v1` |
| `app/register-passkey/RegisterPasskeyClient.tsx` | `auth/passkey-post-register-started/v1`, `auth/passkey-post-register-succeeded/v1`, `auth/passkey-post-register-skipped/v1` |
| `components/ApiKeyDialog.tsx` | `settings/api-key-saved/v1`, `settings/api-key-cleared/v1` |
| `components/CredentialsDialog.tsx` | `settings/credentials-saved/v1`, `settings/credentials-cleared/v1` |
| `app/admin/AdminPermissionsClient.tsx` | `admin/evolve-permission-toggled/v1` (action: grant/revoke) |
| `app/admin/rollback/AdminRollbackClient.tsx` | `admin/rollback-applied/v1` |
| `app/admin/server-health/AdminServerHealthClient.tsx` | `admin/oldest-worktree-deleted/v1` |
| `app/admin/git-mirror/GitMirrorClient.tsx` | `admin/git-mirror-set/v1`, `admin/git-mirror-removed/v1` |
| `app/admin/updates/UpdatesClient.tsx` | `admin/updates-fetch-all/v1`, `admin/update-source-fetched/v1`, `admin/update-source-toggled/v1`, `admin/update-source-removed/v1`, `admin/update-session-created/v1`, `admin/update-source-added/v1` |
| `app/admin/instance/InstanceConfigClient.tsx` | `admin/instance-config-saved/v1` |
| `app/branches/CreateSessionFromBranchButton.tsx` | `branches/create-session-from-branch/v1` |
| `app/CopyButton.tsx` | `content/copy-to-clipboard/v1` |

All events are fire-and-forget — tracking never blocks or breaks any UI interaction.

## Why
Provides a foundation for understanding user behaviour — which flows are used, where users drop off, which actions trigger errors — without requiring an external analytics service. The versioned event name scheme (`action/v1`) allows safe schema evolution over time.
