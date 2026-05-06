# Fix macOS installer sfw shim failing due to SIP-protected /bin

## What changed

`scripts/install.sh` now detects the operating system before installing the
sfw shim and selects the shim directory accordingly:

- **macOS** → `/usr/local/bin` (writable with sudo; `/bin` is read-only due to
  System Integrity Protection)
- **Linux** → `/bin` (unchanged; systemd services need this on PATH without
  extra `Environment=PATH` tuning)

The `bun-real` symlink and the `bun` shim wrapper are both written to
`$SHIM_DIR` instead of the hardcoded `/bin`. The shim script itself now
contains the full path to `bun-real` (`${SHIM_DIR}/bun-real`) rather than
relying on `bun-real` resolving via `$PATH`.

The systemd `ExecStart` line for the `primordia-proxy` service now uses
`${SHIM_DIR}/bun-real`, which on Linux stays `/bin/bun-real` as before.

## Why

On macOS 10.11+ with System Integrity Protection (SIP) enabled, the `/bin`
directory is part of the sealed system volume and cannot be written to even
with `sudo`. Attempting `sudo ln -sf … /bin/bun-real` exits with
`Operation not permitted`, causing the installer to fail immediately after
the user provides their sudo password.

`/usr/local/bin` is the conventional location for user-installed binaries on
macOS, is created by Homebrew (and thus present on most developer Macs), and
is writable with sudo.
