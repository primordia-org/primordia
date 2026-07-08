# Run Next directly with Bun

Changed the Next.js npm scripts to execute `node_modules/next/dist/bin/next` through `bun --bun` instead of invoking the `next` package binary.

The `next` binary is installed with a `#!/usr/bin/env node` shebang, so `bun run --bun next start` could still leave the long-running Next.js process visible as `node` in process listings. Calling the CLI file through Bun directly keeps dev, build, start, and Next type generation on the Bun runtime as intended.
