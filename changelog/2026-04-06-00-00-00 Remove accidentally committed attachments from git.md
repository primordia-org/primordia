# Remove accidentally committed attachments from git

## What changed

Removed three files from git tracking that were accidentally committed into the `attachments/` folder:

- `attachments/Screenshot_2026-04-02-15-20-00-39_3aea4af51f236e4932235fdada7d1643.jpg`
- `attachments/file_000000004b1871f5abb56d4f95b30be9.png`
- `attachments/file_0000000068e471f58e3db5334c9092bc.png`

Used `git rm --cached` to untrack them without deleting them from disk.

## Why

The `attachments/` directory has been in `.gitignore` since the file attachment feature was added (see `.gitignore` line 41-42: `# Uploaded attachments copied into worktrees (transient, not part of the project)` / `/attachments/`). These files must have been committed before or alongside the `.gitignore` entry, causing them to slip through. User-uploaded attachments are transient build artifacts and should never be part of the repository history.
