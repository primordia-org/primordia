# Fix dompurify and undici security vulnerabilities

## What changed

Updated two transitive dependency overrides in `package.json` to eliminate 8 known vulnerabilities flagged by `bun audit`:

### dompurify: `^3.4.9` → `^3.4.11`

The previous override resolved to `3.4.10`, which was still within the vulnerable range (`<=3.4.10`) for:

- **GHSA-cmwh-pvxp-8882** (moderate) — Permanent `ALLOWED_ATTR` pollution via `setConfig()` bypassing the hook clone-guard (incomplete fix of the 3.4.7 hook-pollution patch)

`3.4.11` is the first release that fully addresses this.

### undici: added `^8.5.0` override

`@earendil-works/pi-coding-agent` pinned `undici@8.3.0`, which is within the vulnerable range (`>=8.0.0 <8.5.0`) for 7 CVEs:

- **GHSA-vmh5-mc38-953g** (high) — TLS certificate validation bypass via dropped `requestTls` in SOCKS5 ProxyAgent
- **GHSA-38rv-x7px-6hhq** (high) — WebSocket client DoS via cumulative fragment bypass
- **GHSA-vxpw-j846-p89q** (high) — WebSocket client DoS via fragment count bypass
- **GHSA-pr7r-676h-xcf6** (moderate) — Cross-user information disclosure via shared cache whitespace bypass
- **GHSA-p88m-4jfj-68fv** (moderate) — HTTP header injection via Set-Cookie percent-decoding
- **GHSA-35p6-xmwp-9g52** (low) — HTTP response queue poisoning via keep-alive socket reuse
- **GHSA-g8m3-5g58-fq7m** (low) — Set-Cookie SameSite attribute downgrade via permissive substring matching

`undici@8.5.0` is the first release in the 8.x line to address all of these.

## Why overrides

The vulnerabilities are in transitive dependencies (`streamdown → mermaid → dompurify` and `@earendil-works/pi-coding-agent → undici`). Rather than waiting for upstream packages to release new versions, Bun's `overrides` field forces the entire dependency tree to use the patched versions, which is the standard mitigation approach used elsewhere in this project.

## Verification

- `bun audit` reports **No vulnerabilities found** after the change
- TypeScript typecheck passed
- Production build succeeded
