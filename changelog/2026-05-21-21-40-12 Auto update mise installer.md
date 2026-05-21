# Auto update mise installer

The installer now checks the installed `mise` version output for update warnings before continuing. When `mise` reports that a newer version is available, the installer automatically runs `mise self-update --yes`, refreshes the shell command cache, and reports the updated version.

This prevents installs and updates from continuing with a stale `mise` binary after `mise` has already indicated that `mise self-update` is needed.
