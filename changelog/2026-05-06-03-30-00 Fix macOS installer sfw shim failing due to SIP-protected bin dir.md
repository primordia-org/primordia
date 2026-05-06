# Fix macOS installer sfw shim failing due to SIP-protected /bin

## What changed

`scripts/install.sh` now uses `/usr/local/bin` unconditionally for the sfw
shim instead of `/bin`.

The `bun-real` symlink and the `bun` shim wrapper are both written to
`/usr/local/bin`. The shim script itself uses the full path
`/usr/local/bin/bun-real` rather than relying on `bun-real` resolving via
`$PATH`. The systemd `ExecStart` line for the `primordia-proxy` service also
uses `/usr/local/bin/bun-real`.

## Why

On macOS 10.11+ with System Integrity Protection (SIP) enabled, the `/bin`
directory is part of the sealed system volume and cannot be written to even
with `sudo`. Attempting `sudo ln -sf … /bin/bun-real` exits with
`Operation not permitted`, causing the installer to fail immediately after
the user provides their sudo password.

`/usr/local/bin` works on both platforms:
- **macOS**: conventional location for user-installed binaries; writable with
  sudo; on the default `$PATH`.
- **Linux**: also on `$PATH` for interactive shells and systemd services, and
  writable with sudo — no behaviour change for existing Linux installs.
