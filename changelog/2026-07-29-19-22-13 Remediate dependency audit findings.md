# Remediate dependency audit findings

Updated the dependency lockfile and targeted package ranges to resolve the current `bun audit` report without broad dependency churn.

- Upgraded Next.js and `eslint-config-next` to the patched 16.2.11 release.
- Raised the direct/override PostCSS range to patched 8.5.x releases.
- Added or updated overrides for vulnerable transitive packages where the app does not depend on them directly, including `@hono/node-server`, `body-parser`, `brace-expansion`, `dompurify`, `fast-uri`, `hono`, `js-yaml`, `protobufjs`, and `sharp`.
- Refreshed `bun.lock` with `bun install`.

Validation now reports no vulnerabilities from `bun audit`, and the application still passes typecheck and production build.
