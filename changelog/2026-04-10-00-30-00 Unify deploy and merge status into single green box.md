# Unify deploy and merge status into single green box

## What changed

The evolve session view previously showed two redundant elements after a session was accepted:

1. A collapsible `<details>` log section with a green border titled "✅ Deployed to production" or "✅ Merged into `parent`"
2. A separate "Changes accepted" green banner below with a description sentence

These have been merged into a single component that:

- Uses the green-box styling (`bg-green-900/40 border border-green-700/50`) from the old banner
- Shows the appropriate title — "🚀 Deployed to production" (production deploy) or "✅ Merged into `branchname`" (legacy merge)
- Includes a short description sentence inline (same text as the old banner)
- Has a collapsible "Deploy log" section underneath showing the step-by-step output

## Why

The two-element display was visually redundant: both communicated the same outcome. Consolidating them removes the duplication and makes the accepted state cleaner.
