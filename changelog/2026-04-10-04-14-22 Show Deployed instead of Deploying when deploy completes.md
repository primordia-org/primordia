# Show "Deployed" instead of "Deploying" when deploy is complete

## What changed

In `components/EvolveSessionView.tsx`, added a new `isDeploySection` branch inside `LogSection` that handles the `### 🚀 Deploying to production` and `### 🚀 Merging into …` section headings specially:

- **While active** (deploy in progress): renders with gray border and "Running…" spinner — same as the default active state.
- **When done** (deploy complete): renders with a green border (`border-green-700/50`) and a green heading (`text-green-300`) that reads `✅ Deployed to production` (or `✅ Merged into …` for the non-production case) instead of leaving the original "Deploying to production" text.

## Why

Once deployment finishes, the section card kept its original `### 🚀 Deploying to production` heading inside a plain gray collapsible, which was confusing — it looked like it was still in progress. The user reported this and asked for the heading to say "Deployed" and have a green outline once complete.
