# Remove inaccurate "Production deployment is on its way!" message

## What changed

Removed the phrase "Production deployment is on its way!" from the accepted-changes confirmation message in `components/ChatInterface.tsx`.

## Why

The message was misleading. It claimed a production deployment was happening whenever a PR was merged, but that's only true if the target branch is `main`. In a hyperforkable app like Primordia where branches can be anything, the notion of "production" is ambiguous. The simpler message — "✅ Changes accepted and merged into `{branch}`." — is accurate in all cases.
