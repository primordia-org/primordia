# Fix evolve prompt changelog instructions to use changelog directory

## What changed

Updated the changelog instructions in both evolve LLM prompts to align with the file-based changelog system described in PRIMORDIA.md:

- **`lib/local-evolve-sessions.ts`**: Replaced step 1 ("Update the Changelog section of PRIMORDIA.md with a brief entry") with correct instructions to create a new `changelog/YYYY-MM-DD-HH-MM-SS Description.md` file.
- **`.github/workflows/evolve.yml`**: Replaced the system-prompt instruction to "update its Changelog section" with the correct instruction to create a new file in `changelog/`.

## Why

PRIMORDIA.md's Changelog section explicitly states that changelog entries must be stored exclusively in `changelog/` — never in PRIMORDIA.md itself. The old prompts contradicted this, which would cause Claude to write changelog entries directly into PRIMORDIA.md instead of creating the correct timestamped files in `changelog/`.
