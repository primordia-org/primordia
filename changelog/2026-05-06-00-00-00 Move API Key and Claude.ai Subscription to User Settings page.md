# Move API Key and Claude.ai Subscription to Account Settings page

## What changed

- Removed "API Key" and "Claude.ai Subscription" from the hamburger menu dropdown.
- Added a new **Account Settings** link in the hamburger menu (indigo accent, gear icon) for all logged-in users.
- Created `/settings` — **API Keys** tab: card-based layout with a functional Anthropic key card and coming-soon cards for OpenAI and Google Gemini.
- Created `/settings/claude-ai` — **Claude.ai Subscription** tab: card-based OAuth sign-in flow and manual credentials.json paste; uses the ClaudeIcon brand icon instead of a generic key icon.
- Page is called **Account Settings** (in nav subtitle, page title, and hamburger menu) so users understand these are per-user settings, not app-wide config.
- `SettingsSubNav` sidebar shows live green status dots next to tabs where a key/credential is already set, so users can see active status without navigating into each tab.
- Both pages display a precedence chain (`Claude.ai › Anthropic API key › exe.dev gateway`) so users understand which credential takes priority.
- Claude.ai tab: "Sign in again" and "Clear" buttons are side by side instead of stacked full-width.
- Both pages follow the same layout as the Admin page: `PageNavBar` header, sidebar subnav, and content area.

## Why

The hamburger menu was getting crowded. Moving credentials to a dedicated page gives each setting more room. The wider card-based layout (instead of a narrow dialog) suits a full page better. The "Account Settings" name makes the scope clear — these are user-scoped settings, not instance/app config. The coming-soon provider grid signals that more AI provider integrations are planned.
