# Add Bun install security scanner

## What changed

- Added `bunfig.toml` with a 24-hour `minimumReleaseAge` for new package resolution.
- Configured Bun's security scanner API to use `@socketsecurity/bun-security-scanner`.
- Added the Socket Bun scanner as a dev dependency and updated `bun.lock`.
- Removed the installer-managed `sfw`/`bun-real` shim setup from `scripts/install.sh`.
- Switched app scripts and the systemd service unit back to the real Bun binary, with `~/.bun/bin` included in the service `PATH` so child processes can run `bun`.
- Updated `packageManager` to `bun@1.3.13`, matching the Bun version used to verify the security scanner API.

## Why

Bun now has native install-time security hooks, so Primordia can use Socket's Bun security scanner directly instead of routing all Bun invocations through the older Socket Firewall shim. The 24-hour release-age gate also reduces exposure to newly published malicious packages before they are widely detected.
