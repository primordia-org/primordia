# Show install crash line on accept failure

Accept deploy failures now preserve and display the installer's final failure diagnostics instead of reducing the error to `install.sh exited with code 1`.

`scripts/install.sh` now reports unexpected non-typecheck exits from both `ERR` trap failures and explicit `exit 1` paths. The report includes the current installer step, line number, exit code, and failed command before printing the existing server diagnostics.

The accept route also gives `install.sh` stdout/stderr a short drain window after the bash process exits before destroying the streams. This prevents the final failure report from being dropped when the session log is updated from the web accept flow.
