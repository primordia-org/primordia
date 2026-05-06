# Fix install script hanging for sudo password when shim already installed

## What changed

In `scripts/install.sh`, the "install sfw shim" section was unconditionally
running `sudo mkdir -p "${SHIM_DIR}"` (`/usr/local/bin`) even when the shim
was already fully installed from a previous run. This caused the script to
pause at `✓ Using sfw` and wait for a sudo password, even though `/usr/local/bin`
virtually always already exists on both macOS and Linux.

The fix wraps the `sudo mkdir -p` in an existence check:

```bash
if [[ ! -d "${SHIM_DIR}" ]]; then
  sudo mkdir -p "${SHIM_DIR}"
fi
```

The other two `sudo` calls in the same section (`sudo ln -sf` for the
`bun-real` symlink and `sudo tee`/`sudo chmod` for the shim script) were
already guarded by their own idempotency checks, so they were never the source
of the spurious password prompt.

## Why

On a machine where the shim is already in place, the installer should be
completely non-interactive when re-run (e.g. during an update). Prompting for
a sudo password when nothing actually needs to change is confusing and breaks
automated update flows.
