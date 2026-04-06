# Fix git clone via PATH_TRANSLATED

## What changed

- **`app/api/git/[...path]/route.ts`**: Two fixes:
  1. `resolveGitDir()` now wraps the result of `git rev-parse --git-common-dir` with `path.resolve(process.cwd(), result)` so `GIT_DIR` is always an absolute path.
  2. Added `PATH_TRANSLATED: GIT_DIR + pathInfo` to the CGI environment passed to `git http-backend`. git http-backend's CGI interface **requires** either `GIT_PROJECT_ROOT` or `PATH_TRANSLATED` to be present — `GIT_DIR` alone is not enough. By setting `PATH_TRANSLATED = GIT_DIR + PATH_INFO`, git http-backend strips the `PATH_INFO` suffix to derive the repo root (which is `GIT_DIR` itself) and proceeds normally.

- **`app/branches/page.tsx`**: Added the clone URL (`<host>/api/git`) to the legend section so users can see the correct URL to use.

## Why

`git clone https://primordia.exe.xyz/api/git` was failing with:

```
[git-http-backend] fatal: No GIT_PROJECT_ROOT or PATH_TRANSLATED from server
```

This is a hard CGI requirement in git http-backend — it will not start without one of these two variables. `GIT_DIR` is a git env var that influences where git looks for the object store, but git http-backend also needs `PATH_TRANSLATED` (or `GIT_PROJECT_ROOT`) to locate the repository via the CGI interface.
