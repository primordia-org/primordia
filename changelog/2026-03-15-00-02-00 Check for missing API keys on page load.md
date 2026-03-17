## Check for missing API keys on page load and warn in chat

**What changed**:
- New `app/api/check-keys/route.ts`: GET endpoint that checks `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, and `GITHUB_REPO` server-side and returns any that are absent.
- `components/ChatInterface.tsx`: new `useEffect` on mount calls `/api/check-keys`; if any keys are missing, a system message is prepended to the chat listing the missing variables and which features they affect.

**Why**: Users who deploy without setting all required environment variables get no feedback on why chat or evolve mode fails. The on-load check surfaces the problem immediately with a clear message instead of leaving them to debug silently failing API calls.
