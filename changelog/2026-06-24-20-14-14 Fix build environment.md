# Fix build environment

## What changed

- Updated the `build` package script to force `NODE_ENV=production` when invoking `next build`.

## Why

The coding-agent environment can leave `NODE_ENV=development` set while validation runs. Next.js warns that this is unsupported for production builds and, in this case, failed while prerendering `/_global-error`. Forcing the build script to use the production environment makes `bun run build` deterministic regardless of the caller's inherited shell environment.
