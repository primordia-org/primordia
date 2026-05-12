# Refresh branch DB on apply updates

When a user clicks **Apply Updates** for an evolve session, Primordia now refreshes that branch's `.primordia-auth.db` from the current production slot after merging the production branch.

The copy uses SQLite `VACUUM INTO` to create a clean, consistent, WAL-free snapshot even if production is actively writing to the database. This keeps local preview branches aligned with both the latest production code and production data.
