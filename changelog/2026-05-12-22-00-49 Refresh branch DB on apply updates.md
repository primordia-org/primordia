# Refresh branch DB on apply updates

When a user clicks **Apply Updates** for an evolve session, Primordia now refreshes that branch's `.primordia-auth.db` from the current production slot after merging the production branch.

The refresh uses SQLite `VACUUM INTO` to create a clean, consistent, WAL-free snapshot even if production is actively writing to the database. If the preview dev server is running, Primordia now asks that preview server to close its SQLite handle, swap in the snapshot, and reopen lazily on the next DB access instead of replacing the DB file underneath an open connection. This keeps local preview branches aligned with both the latest production code and production data without destabilizing the running preview.
