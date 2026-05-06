# Change Claude credentials icon to Anthropic logo

Changed the icon shown next to the session auth indicator when claude.ai OAuth credentials were used.

**What changed:**
- Replaced the `FileKey` (lucide-react) icon with the Claude mark sourced from `platform.claude.com/favicon.svg` (background rect and clip-path removed, fill set to `currentColor` so it inherits surrounding text color)
- Extracted the icon into a reusable `ClaudeIcon` component at `components/brand-icons/ClaudeIcon.tsx` with a configurable `size` prop (default 16)
- Updated tooltip from "Used Claude Credentials" to "Used claude.ai login"
- Icon rendered at 16×16px (up from 11×11)

**Why:**
The previous `FileKey` icon was generic and didn't communicate that the session authenticated via claude.ai subscription OAuth. The Claude mark is immediately recognizable. Moving it to `components/brand-icons/` makes it reusable across the app.
