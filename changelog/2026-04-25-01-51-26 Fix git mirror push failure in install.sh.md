# Fix git mirror push failure in install.sh

## What changed

`scripts/install.sh`: `advance_main_and_push()` changed from:

```bash
git -C "${BARE_REPO}" push mirror main 2>/dev/null
```

to:

```bash
_mirror_err="$(mktemp)"
git -C "${BARE_REPO}" push mirror 2>"$_mirror_err"
```

Two fixes in one:

1. **`push mirror main` → `push mirror`** — the mirror remote is configured with `--mirror=push` (refspec `+refs/*:refs/*`). Passing an explicit branch name overrides the configured push refspecs, which causes git to attempt a plain `refs/heads/main:refs/heads/main` push instead of the force-push mirror refspec. `git push mirror` (no branch) uses the configured mirror refspecs and is exactly what the admin setup UI (`app/api/admin/git-mirror/route.ts`) already does correctly.

2. **`2>/dev/null` → capture stderr** — the old code swallowed all error output, making the warning message useless for debugging. Now stderr is captured to a temp file and the last 3 lines are included in the warning, so future failures are immediately actionable.

## Why it failed

The `--mirror=push` remote config includes `push = +refs/*:refs/*` (force-push all refs). When `main` is specified explicitly, git ignores those configured refspecs and uses a plain refspec without the `+` force flag. If the remote is slightly ahead (or has diverged), this causes a non-fast-forward rejection. Meanwhile `git push mirror` (as the user confirmed works manually) honours the `+refs/*:refs/*` refspec and force-pushes cleanly.
