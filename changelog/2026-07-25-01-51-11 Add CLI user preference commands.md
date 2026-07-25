# Add CLI user preference commands

Added `bun run primordia preferences get` and `bun run primordia preferences set` so local CLI users can inspect and update per-user thread defaults without opening the web UI.

The new commands support selecting a user, JSON output, preferred preset updates, fallback harness/model defaults, and caveman mode/intensity defaults. Inputs are validated against known presets, harnesses, models, and caveman intensities so invalid saved preferences are rejected at the CLI boundary.
