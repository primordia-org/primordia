# Add post-copy DB diagnostics to install.sh

## What changed

After the `VACUUM INTO` DB copy step in `scripts/install.sh`, added a
diagnostic block that runs immediately before the script continues to
deploy the new slot.

Diagnostics emitted (as `diag` lines, so they appear dimmed but are
always visible):

- Source and destination file sizes
- Destination file permissions
- Whether WAL/SHM files were left behind after the copy
- `PRAGMA integrity_check` result on the new DB
- Page count and table count
- Remaining disk space on the install directory

If `integrity_check` returns anything other than `ok`, the script now
calls `die` immediately instead of silently continuing — surfacing a
corrupt copy as the root cause rather than letting it trigger a
cryptic failure several steps later.

## Why

"✓ DB copied / ❌ Accept failed: install.sh exited with code 1" has
happened multiple times. The copy itself succeeds (SQLite reports no
error), but something about the resulting DB or the environment at
that point causes a downstream failure.  Without post-copy diagnostics
the logs offered no clue.  This change ensures that on the next
occurrence the logs will show exactly what the DB looked like at the
moment of copy.
