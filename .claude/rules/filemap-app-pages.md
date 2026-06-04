---
paths:
  - "app/**"
  - "components/**"
---

## File Map: app/ (pages) and components/

```
components/auth-tabs/            ← Client-side auth tab components keyed by lib/auth-providers/registry.ts
├── passkey/index.tsx            ← default export: PasskeyTab
├── exe-dev/index.tsx            ← default export: ExeDevTab
└── cross-device/index.tsx       ← default export: CrossDeviceTab

components/                      ← Shared React components
├── AdminSubNav.tsx              ← Tab subnav for admin pages: users, logs, rollback, health, mirror, instance, updates, dependencies, events
├── AdminUpdatesBell.tsx         ← Bell notification icon for admin update/security alerts
├── AgentIdentity.tsx            ← Shared auth-source/harness identity line and icon helpers for agent blocks, presets, and settings
├── AnsiRenderer.tsx             ← Renders text with ANSI escape codes as styled React elements (colors, bold, spinner overwrite)
├── EvolveRequestForm.tsx        ← Shared evolve request form with preset/harness/model selection, attachments, and element inspector
├── FloatingEvolveDialog.tsx     ← Draggable, dockable floating popup opened from hamburger "Propose a change"
├── ForbiddenPage.tsx            ← Server component: informative 403 access-denied page
├── HamburgerMenu.tsx            ← Reusable hamburger button + dropdown for nav and evolve entry points
├── LocalizedTimestamp*.tsx      ← Server/client pair for browser-local timestamp hydration
├── MarkdownContent.tsx          ← Block-prose markdown renderer with dark styling used on session pages and changelogs
├── ModelPicker.tsx              ← Shared grouped model selector with provider icons and pricing metadata
├── NavHeader.tsx                ← Shared nav header used by /evolve/session, /changelog, /branches pages
├── PageElementInspector.tsx     ← Full-screen portal overlay for picking DOM elements with screenshot capture
├── PageNavBar.tsx               ← Shared nav header + hamburger for static information pages
├── ProgressBar.tsx              ← Shared progress bar primitive
├── QrSignInOtherDeviceDialog.tsx ← Dialog for authenticated users to initiate push cross-device sign-in with QR code
├── ServerLogsClient.tsx         ← Client component: live tail of primordia systemd journal via SSE (/admin/logs)
├── SettingsSubNav.tsx           ← Tab subnav for account/settings pages
├── SimpleMarkdown.tsx           ← Minimal markdown renderer (bold, links, inline code, code blocks)
├── WebPushCategoryButton.tsx    ← Subscribe/test control for a single web-push notification category
└── brand-icons/                 ← SVG/PNG provider icons used by model and billing-source UIs

app/                             ← Next.js App Router
├── layout.tsx                   ← Root layout (font, metadata, body styling)
├── page.tsx                     ← Landing page — marketing/feature overview; links to /evolve and /login
├── globals.css                  ← Tailwind base imports only
├── icon.png                     ← App favicon
├── ChangelogNewsticker.tsx      ← Server component: renders recent changelog entries as an animated newsticker
├── CopyButton.tsx               ← Client button: copies text to clipboard with visual feedback
├── InstallBlock.tsx             ← Interactive install UI block with SSH command and live VM name input
├── LandingNav.tsx               ← Floating hamburger menu in top-right of landing page with lazy-loaded evolve dialog
├── LandingSections.tsx          ← Server components for landing page sections
├── SimpleCurlBlock.tsx          ← Client component for copyable curl/API command examples
├── under-the-hood/page.tsx      ← Public explainer page for Primordia internals and self-modifying architecture
├── test-pages/                  ← Developer/component test pages
│   ├── page.tsx                 ← Index of all test pages
│   ├── ansi-test/page.tsx       ← Interactive test page for AnsiRenderer
│   ├── claude-auth-test/page.tsx ← Manual test page for Claude OAuth credential capture flow
│   ├── markdown-test/page.tsx   ← Interactive test page for MarkdownContent streaming behavior
│   ├── sound-test/page.tsx      ← Web Audio API soundboard with oscilloscope and browser diagnostics
│   └── web-push-test/           ← Web push notification diagnostics and category simulation
├── branches/                    ← Branch tree page and branch-to-session actions
│   ├── page.tsx                 ← Server component: git branch tree; publicly viewable; admin-only actions conditionally hidden
│   ├── BranchParentSourceToggle.tsx ← Client toggle for parent source (`git-config` vs `branch-marker`)
│   └── CreateSessionFromBranchButton.tsx ← Client component: "+ session" inline form for existing branches
├── changelog/                   ← Runtime changelog reader
│   ├── page.tsx                 ← Server component: reads changelog/ filenames and lazy-loads bodies
│   └── ChangelogEntryDetails.tsx ← Client <details> widget; fetches body from /api/changelog on first open
├── admin/                       ← Admin-only pages; all render ForbiddenPage for logged-in non-admins
│   ├── page.tsx                 ← Manage users and grant/revoke evolve access
│   ├── AdminPermissionsClient.tsx ← Client component for permission mutations
│   ├── dependencies-security/   ← bun audit results, severe vulnerability alerts, evolve-session creation
│   ├── events/                  ← Paginated/filterable user event log viewer
│   ├── git-mirror/              ← Mirror remote configuration and push status
│   ├── instance/                ← Instance identity, canonical URL, parent/peer graph settings
│   ├── logs/page.tsx            ← Production server logs with live tail
│   ├── proxy-logs/page.tsx      ← primordia-proxy journal logs with live tail
│   ├── rollback/                ← Deep rollback from productionHistory
│   ├── server-health/           ← Disk/memory usage and oldest-worktree cleanup
│   └── updates/                 ← Upstream update sources fetch/merge UI
├── api-docs/                    ← Interactive OpenAPI reference powered by @scalar/api-reference-react
├── evolve/                      ← Evolve request page and session tracker
│   ├── page.tsx                 ← Dedicated "propose a change" page; requires evolve permission
│   ├── EvolveForm.tsx           ← Client wrapper for <EvolveRequestForm>
│   └── session/[id]/            ← Session page, live event stream, diff summary, preview browser panel, resize handle
├── install.sh/route.ts          ← Returns install.sh with origins/base paths rewritten for the current instance
├── login/                       ← Auth provider tab UI plus cross-device approval/receive pages
├── settings/                    ← Account settings for billing sources, API keys, Claude/ChatGPT subscriptions, presets, notifications
└── schemas/instance/v1.json/route.ts ← Serves the JSON Schema for Primordia instance manifests
```
