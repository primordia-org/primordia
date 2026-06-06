# Remediate hono and qs moderate vulnerabilities

## What changed

Updated two packages in `package.json` overrides to resolve moderate security vulnerabilities found by `bun audit`:

### hono (4 advisories, all fixed in ≥ 4.12.21)

- **GHSA-xrhx-7g5j-rcj5** — IP Restriction middleware bypasses static deny rules for non-canonical IPv6 addresses (CVSS 5.3)
- **GHSA-3hrh-pfw6-9m5x** — Cookie helper does not sanitize `sameSite` and `priority` fields, allowing Set-Cookie header injection (CVSS 4.3)
- **GHSA-f577-qrjj-4474** — JWT middleware accepts any Authorization scheme, not only `Bearer` (CVSS 4.8)
- **GHSA-2gcr-mfcq-wcc3** — `app.mount()` strips mount prefix using undecoded path, causing incorrect routing for percent-encoded paths (CVSS 5.3)

**Fix:** Bumped the `hono` override from `^4.12.19` → `^4.12.21`. Resolved version: `4.12.23`.

`hono` enters the graph as a transitive dependency of `@modelcontextprotocol/sdk`; it is not a direct dependency. The existing override that was already in `package.json` is the correct mechanism to pin it.

### qs (1 advisory, fixed in > 6.15.1)

- **GHSA-q8mj-m7cp-5q26** — `qs.stringify` crashes with a `TypeError` on null/undefined entries in comma-format arrays when `encodeValuesOnly` is set, enabling a remotely triggerable DoS (CVSS 5.3)

**Fix:** Added `"qs": "^6.15.2"` to the `overrides` block in `package.json`. Resolved version: `6.15.2`.

`qs` enters the graph as a transitive dependency of `express` → `body-parser`, which is itself a transitive dependency of `@modelcontextprotocol/sdk`. Since `qs` is not used directly by Primordia, an override is the correct mechanism.

## Why

These vulnerabilities were surfaced by the automated daily `bun audit` check (see `/admin/dependencies-security`). All four are rated **moderate**. Upgrading closes them without any breaking API changes — both are semver-compatible patch releases.

## Validation

- `bun install` — 2 packages updated, lockfile saved
- `bun audit` — **No vulnerabilities found**
- `bun run typecheck` — **✓ Types generated successfully**
- `bun run build` — **✓ Compiled successfully**
