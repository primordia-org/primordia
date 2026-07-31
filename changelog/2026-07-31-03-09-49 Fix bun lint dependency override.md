# Fix bun lint dependency override

Restored the audited `brace-expansion` override so dependency scans continue resolving the patched version required by `bun audit`.

ESLint 9 still includes legacy `minimatch@3` copies that expect `require("brace-expansion")` to return the expand function directly, while audited `brace-expansion@5` exposes that function as `expand`. The lint script now runs ESLint through a tiny Bun shim that adapts only that CommonJS require shape for the lint process.

This keeps `bun run lint` working without reintroducing vulnerable `brace-expansion` 1.x packages into the lockfile.
