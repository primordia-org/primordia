# Add readonly git HTTP access via git-http-backend

## What changed

Added a new API route at `/api/git/[...path]` that proxies git smart HTTP protocol requests to the system `git http-backend` CGI process.

**Clone URL:** `git clone http[s]://<host>/api/git`

### New file

- `app/api/git/[...path]/route.ts` — handles `GET` and `POST` requests for git fetch/clone. Forwards request headers, method, query string, and body to `git http-backend` via stdin/env vars, then parses the CGI response headers from stdout and streams the pack body back to the caller.

### Readonly enforcement

Push operations (`git-receive-pack`) are blocked with a `403 Forbidden` response before `git http-backend` is even spawned:

- `GET /api/git/info/refs?service=git-receive-pack` → 403
- `POST /api/git/git-receive-pack` → 403

All `git-upload-pack` operations (fetch, clone, shallow clone) are allowed without authentication.

### Git dir resolution

In Primordia's worktree layout the current process directory is a linked worktree, not the main repo. The route calls `git rev-parse --git-common-dir` once at module load time to find the shared object store (e.g. `/home/exedev/primordia/.git`) and passes that as `GIT_DIR` to each `git http-backend` invocation.

## Why

Primordia is designed to be a self-modifying source of truth. Exposing read-only git access over HTTP lets child instances (forks, downstream deployments) pull updates directly from the running Primordia instance without needing SSH access or a GitHub intermediate. This is a foundational step toward a fork/sync flow where child instances stay in sync with their parent.
