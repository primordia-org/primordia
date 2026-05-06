# Fix proxy not starting server after local branch accept

## What changed

`scripts/reverse-proxy.ts`: when `readAllPorts()` detects that the production
branch or upstream port has changed **and** there is no currently-running
production server (`prodServerEntry` is null), it now immediately calls
`startProdServerIfNeeded()` via `setTimeout(..., 0)`.

## Why

On localhost (local / legacy accept flow), there is no `POST /_proxy/prod/spawn`
call — the evolve pipeline just merges the session branch, kills the old dev
server worktree, and updates `primordia.productionBranch` in git config.

The proxy watches `.git/config` with `fs.watch` and calls `readAllPorts()` when
it changes, correctly updating `upstreamPort`.  But it never called
`startProdServerIfNeeded()` from that path, so the new production server was
never spawned and all requests returned ECONNREFUSED:

```
[proxy] production server exited (code 0)
[proxy] upstream port: 3003 → 3004 (PROD branch: caveman-full-before-creating)
[proxy] upstream error on port 3004: ECONNREFUSED
```

The fix also captures the previous prod branch (`prevProdBranch`) before
`currentProdBranch` is overwritten, so the branch-changed comparison
`prodBranch !== prevProdBranch` is evaluated correctly.
