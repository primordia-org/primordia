# Update vulnerable dependencies

Ran `bun audit` and updated vulnerable dependency resolutions so the audit now reports no known vulnerabilities.

## What changed

- Updated direct dependencies including Next.js, Anthropic SDK, Claude Agent SDK, Scalar API Reference, and PostCSS-related packages.
- Added package overrides for vulnerable transitive dependencies pulled in through the agent and documentation toolchains, including protobufjs, fast-uri, basic-ftp, fast-xml-builder, hono, ip-address, mermaid, brace-expansion, postcss, and uuid.
- Regenerated `bun.lock` with the hardened dependency graph.

## Why

The previous dependency tree included high and moderate advisories reported by `bun audit`, including Next.js security fixes and vulnerable transitive packages in the coding-agent stack. The updated lockfile now passes `bun audit` cleanly.
