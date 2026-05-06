# Change Claude credentials icon to Anthropic logo

Changed the icon shown next to the session auth indicator when claude.ai OAuth credentials were used.

**What changed:**
- Replaced the `FileKey` (lucide-react) icon with an inline SVG of the Claude mark (sourced from `platform.claude.com/favicon.svg`), background and clip-path removed, fill set to `currentColor` so it inherits surrounding text color
- Updated tooltip from "Used Claude Credentials" to "Used claude.ai login"
- Updated aria-label to match

**Why:**
The previous `FileKey` icon was generic and didn't communicate that the session authenticated via claude.ai subscription OAuth. The Anthropic "A" mark is immediately recognizable and directly connects the indicator to Claude.ai.
