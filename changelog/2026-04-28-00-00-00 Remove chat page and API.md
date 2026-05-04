# Remove chat page and API

Removed the `/chat` page, `ChatInterface` component, and `POST /api/chat` streaming
endpoint as part of simplifying the app for broader use.

## What changed

- Deleted `app/chat/page.tsx` and `app/chat/ChatInterface.tsx`
- Deleted `app/api/chat/route.ts`
- Deleted `app/api/check-keys/route.ts` (was only used by the chat page to warn about missing env vars)
- Removed "Go to chat" item from `HamburgerMenu`'s `buildStandardMenuItems()`
- Removed "AI Chat" feature card from the landing page (`LandingSections.tsx`)
- Collapsed the "How it works" steps from 4 to 3 by removing the "Chat" step
- Removed the "Chat" link from the landing page footer

## Why

The built-in AI chat was a nice demo but adds complexity and isn't critical to
Primordia's core purpose (self-modification via the evolve pipeline). Removing it
shrinks the surface area and makes the app easier for others to understand and fork.

The supporting infrastructure (API key management, LLM encryption, `llm-client.ts`)
is kept because the evolve pipeline still uses it (for branch-slug generation via
Claude Haiku and for forwarding user-supplied Anthropic API keys).
