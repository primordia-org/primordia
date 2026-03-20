# Remove GitHub PR mention from welcome message

## What changed

Removed the sentence "Your idea will be turned into a GitHub PR automatically." from the welcome message in `components/ChatInterface.tsx`.

The message now reads: "Hi! I'm Primordia. You can chat with me, or switch to **evolve mode** to propose a change to this app itself."

## Why

The GitHub PR detail is an implementation detail of the production evolve pipeline — not something users need to know upfront, and actively confusing in local dev where no PR is created. The shorter message is cleaner and accurate in all environments.
