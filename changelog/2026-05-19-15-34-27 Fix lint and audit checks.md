# Fix lint and audit checks

## What changed

- Removed the global `brace-expansion` override so ESLint's older `minimatch` dependency can install a compatible patched `brace-expansion` 1.x release.
- Added a `ws` override to force the patched `8.20.1` release required by `bun audit`.
- Updated markdown attachment origin handling to avoid synchronous state updates in an effect.
- Removed a stale lint-disable comment from the local-storage draft hook.

## Why

The lint command was failing before it could analyze the project because the global `brace-expansion` override made ESLint's `minimatch` dependency load an incompatible API shape. After fixing dependency resolution, ESLint surfaced one React compiler lint error and one stale disable comment. `bun audit` also reported a moderate `ws` advisory, so the dependency override now pins a non-vulnerable release.
