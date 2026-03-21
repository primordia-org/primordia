# Hide local dev implementation detail from evolve banner

## What changed

Removed the sentence "Claude Code will implement it locally in a preview server — no GitHub required." from the description banner on the `/evolve` page.

Previously, when the app was running in development mode (`NODE_ENV=development`), the banner showed extra text explaining the underlying local-preview implementation. Production showed only the simpler "Describe a change you want to make to this app." copy.

The conditional branch has been removed entirely; both environments now display the same user-facing copy: **"Evolve Primordia — Describe a change you want to make to this app."**

## Why

This was an implementation detail — how the sausage is made — that end users (non-developers) don't need to know or understand. Exposing the mechanics of the local dev flow adds noise without helping users accomplish their goal. The simpler, consistent copy keeps the UI clean and focused.
