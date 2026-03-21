# Shorter local dev branch names

## What changed

- **Slug length reduced from 3–5 words to 2–4 words.** Claude Haiku is now prompted for a 2–4 word slug; the plain-text fallback also caps at 4 words instead of 5.
- **Removed the mnemonic two-word suffix.** Previously every branch was `evolve/{slug}-{adjective}-{noun}` (e.g. `evolve/add-dark-mode-infamous-manatee`). Now it is simply `evolve/{slug}` (e.g. `evolve/add-dark-mode`).
- **Collision detection added.** Before creating the worktree, the code runs `git branch --list evolve/{slug}` to check whether the branch already exists. If it does, it retries with `evolve/{slug}-2`, `-3`, … up to `-99`, and falls back to a millisecond timestamp suffix in the extreme case that all 99 suffixed names are also taken.
- **Removed the `mnemonic-id` dependency** from `package.json` — it is no longer needed now that uniqueness is handled by the git-check loop.

## Why

Branch names like `evolve/add-dark-mode-infamous-manatee` were unwieldy in `git branch -a`, terminal tab-completion, and the preview URL displayed in the chat. Dropping the random words and capping slugs at four words keeps names readable. The explicit existence check provides the same collision-safety guarantee without random noise.
