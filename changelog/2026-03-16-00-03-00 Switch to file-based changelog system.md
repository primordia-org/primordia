Replaced git-history-based changelog with a file-based system where each change gets its own `.md` file in `changelog/`.

**Background**: A git-history-based changelog was first experimented with (`scripts/generate-changelog.mjs` reading from `git log`), including a workaround for Vercel's shallow clone / no-remote environment. However, git commit messages are too terse to capture the level of detail of the original PRIMORDIA.md entries. The file-based approach was chosen instead.

**What changed**:
- `changelog/` directory (new): contains one `.md` file per change, named `YYYY-MM-DD-HH-MM-SS Description of change.md`. The filename provides a short description (useful for context management — agents can read the directory listing to get an overview, then open individual files for detail). The file body contains the full rich description.
- `scripts/generate-changelog.mjs` (new): reads `changelog/*.md` files. Parses date+time from the filename, uses the remaining filename part as the title, reads the file body as content, sorts newest-first, and writes `public/changelog.json`.
- `app/changelog/page.tsx` (new): renders each entry as a `<details>`/`<summary>` disclosure widget. The summary shows the date and title; expanding it reveals the full markdown content rendered as preformatted text.
- `components/ChatInterface.tsx`: added a "Changelog" link in the subtitle below the "Primordia" heading.
- `package.json`: added `prebuild` and `predev` scripts that run `generate-changelog.mjs` automatically before every build and local dev start.
- `.gitignore`: added `public/changelog.json` — it's a build artifact and should not be committed to git.
- `PRIMORDIA.md`: updated File Map, Design Principles (new protocol: add a `changelog/YYYY-MM-DD-HH-MM-SS Description.md` file instead of prepending to the Changelog section), and this entry.

**Why**: File-based entries preserve the rich "what + why" descriptions, avoid any git-history depth issues, work identically in all environments (local/CI/Vercel), and use filenames as natural short descriptions for AI context management.
