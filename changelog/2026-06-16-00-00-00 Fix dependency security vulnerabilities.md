# Fix Dependency Security Vulnerabilities

## What Changed

Updated the `overrides` section in `package.json` to resolve 18 security vulnerabilities across 6 packages. All changes use Bun's resolution overrides to force transitive dependencies to patched versions without introducing unrelated dependency churn.

### New overrides added

| Package | Previous override | New override | Vulnerabilities fixed |
|---|---|---|---|
| `@babel/core` | *(none)* | `^7.29.1` | 1 low (arbitrary file read via sourceMappingURL) |
| `dompurify` | *(none)* | `^3.4.9` | 7 low/moderate XSS and config-pollution issues |
| `js-yaml` | *(none)* | `^4.2.0` | 1 moderate (quadratic-complexity DoS on merge keys) |

### Existing overrides tightened

| Package | Previous | New | Vulnerabilities fixed |
|---|---|---|---|
| `hono` | `^4.12.21` | `^4.12.25` | 5 moderate/high (path traversal, CORS wildcard, cookie merging, body-limit bypass) |
| `protobufjs` | `^8.3.0` | `^8.5.1` | 3 moderate/high (prototype shadow, unbounded Any expansion, memory amplification) |
| `ws` | `^8.20.1` | `^8.21.0` | 1 high (memory exhaustion DoS from tiny fragments) |

### Dependency chains resolved

- `dompurify`: `streamdown › mermaid › dompurify`
- `hono`: `@anthropic-ai/claude-agent-sdk › @modelcontextprotocol/sdk › @hono/node-server › hono` and `@mariozechner/pi-coding-agent › … › @modelcontextprotocol/sdk › @hono/node-server › hono`
- `js-yaml`: `next-openapi-gen › js-yaml` and `eslint › @eslint/eslintrc › js-yaml`
- `protobufjs`: `@mariozechner/pi-coding-agent › … › @google/genai › protobufjs`
- `ws`: `@mariozechner/pi-coding-agent › … › openai › ws`
- `@babel/core`: `eslint-config-next › eslint-plugin-react-hooks › @babel/core`

## Why

`bun audit` reported 18 vulnerabilities (3 high, 11 moderate, 4 low). All affected packages were transitive dependencies pulled in by `streamdown`, `@anthropic-ai/claude-agent-sdk`, `@mariozechner/pi-coding-agent`, `next-openapi-gen`, and `eslint-config-next`. Since these packages are not direct dependencies (or their semver ranges did not guarantee patched versions), Bun's resolution `overrides` was used to force the entire dependency graph to use patched versions.

After applying these overrides, `bun install` + `bun audit` reports **No vulnerabilities found**, and `bun run typecheck` and `bun run build` both succeed without errors.
