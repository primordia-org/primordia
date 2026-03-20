# Remove "production" from deployment message

## What changed
Updated the post-merge deployment message in `components/ChatInterface.tsx` from:

> "The changes will be deployed to production shortly."

to:

> "The changes will be deployed shortly."

## Why
The word "production" is inaccurate in the context of deploy previews, where merging a PR doesn't necessarily mean deploying to production. Removing it makes the message more universally correct.
