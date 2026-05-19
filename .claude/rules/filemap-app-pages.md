---
paths:
  - "app/**"
  - "components/**"
---

## File Map: app/ (pages) and components/

```
components/auth-tabs/            ← Client-side auth tab components (no registry — loaded via dynamic import)
├── passkey/index.tsx            ← default export: PasskeyTab
├── exe-dev/index.tsx            ← default export: ExeDevTab
└── cross-device/index.tsx      ← default export: CrossDeviceTab

components/
├── AdminSubNav.tsx            ← Tab subnav for admin pages: "Manage Users" (/admin), "Server Logs" (/admin/logs), "Proxy Logs" (/admin/proxy-logs), "Rollback" (/admin/rollback), "Server Health" (/admin/server-health), "Git Mirror" (/admin/git-mirror), "Instance" (/admin/instance), "Updates" (/admin/updates), "Events" (/admin/events)
├── AgentIdentity.tsx          ← Shared auth-source/harness identity line and icon helpers for agent blocks, presets, and settings
├── AnsiRenderer.tsx           ← Renders text with ANSI escape codes as styled React elements (colors, bold, spinner overwrite)
├── ApiKeyDialog.tsx           ← Modal for setting/clearing user Anthropic API key; stores in localStorage; opened from hamburger menu
├── CredentialsDialog.tsx      ← Modal dialog for pasting Claude Code credentials.json with AES-256-GCM encryption
├── EvolveRequestForm.tsx      ← Shared evolve request form with harness/model selection, attachments, and element inspector
├── FloatingEvolveDialog.tsx   ← Draggable, dockable floating popup with the evolve form; opened from hamburger "Propose a change" on any page
├── ForbiddenPage.tsx          ← Server component: 403 access-denied page with page description, required/met/unmet conditions, and how-to-fix
├── AdminUpdatesBell.tsx       ← Bell notification icon shown to admins when upstream update sources have new commits available
├── HamburgerMenu.tsx          ← Reusable hamburger button + dropdown; used by LandingNav, EvolveForm, EvolveSessionView, PageNavBar
├── MarkdownContent.tsx        ← Block-prose markdown renderer with dark styling used on session pages and changelogs
├── NavHeader.tsx              ← Shared nav header (title, branch name, nav links); used by /evolve/session, /changelog, /branches pages
├── PageElementInspector.tsx   ← Full-screen portal overlay for picking DOM elements on current page with screenshot capture
├── PageNavBar.tsx             ← Shared nav header + hamburger for /changelog and /branches pages
├── QrSignInOtherDeviceDialog.tsx ← Dialog for authenticated users to initiate push cross-device sign-in with QR code
├── ServerLogsClient.tsx       ← Client component: live tail of primordia systemd journal via SSE (/admin/logs)
└── SimpleMarkdown.tsx         ← Minimal markdown renderer (bold, links, inline code, code blocks)

app/                           ← Next.js App Router
├── layout.tsx                 ← Root layout (font, metadata, body styling)
├── page.tsx                   ← Landing page — marketing/feature overview; links to /evolve and /login
├── globals.css                ← Tailwind base imports only
├── icon.png                   ← App favicon
├── ChangelogNewsticker.tsx    ← Server component: renders last 12 changelog entries as an animated horizontal newsticker
├── CopyButton.tsx             ← Client button: copies text to clipboard with visual feedback
├── InstallBlock.tsx           ← Interactive install UI block with SSH command and live VM name input
├── LandingNav.tsx             ← Floating hamburger menu in top-right of landing page with lazy-loaded evolve dialog
├── LandingSections.tsx        ← Server components for each landing page section (hero, features, how-it-works, etc.)
├── test-pages/
│   ├── page.tsx               ← Index of all developer/component test pages
│   ├── ansi-test/page.tsx     ← Interactive test page for AnsiRenderer with pre-baked samples and live streaming
│   ├── markdown-test/page.tsx ← Interactive test page for MarkdownContent with speed and chunk-size controls
│   └── sound-test/page.tsx    ← Web Audio API soundboard with oscilloscope and browser diagnostics
├── branches/
│   ├── page.tsx               ← Server component: git branch tree; publicly viewable; admin-only actions conditionally hidden
│   ├── BranchParentSourceToggle.tsx ← Client toggle for per-user branch parent source (`git-config` vs `fork-marker`)
│   └── CreateSessionFromBranchButton.tsx ← Client component: "+ session" button; inline form to start a session on an existing branch
├── changelog/
│   ├── page.tsx               ← Server component: reads changelog/ filenames at runtime; lazy-loads body via /api/changelog
│   └── ChangelogEntryDetails.tsx ← Client component: single changelog <details> widget; lazy-loads body from /api/changelog on first open
├── admin/
│   ├── page.tsx               ← Admin panel: grant/revoke evolve access per user; tab subnav
│   ├── AdminPermissionsClient.tsx ← Client component: grant/revoke 'can_evolve' role per user
│   ├── git-mirror/{page.tsx,GitMirrorClient.tsx} ← Git Mirror: shows mirror remote status; admin only
│   ├── instance/{page.tsx,InstanceConfigClient.tsx} ← Instance identity: name/description/uuid7/graph; admin only
│   ├── logs/page.tsx          ← Server logs: pre-fetches initial log buffer; live tail via ServerLogsClient; admin only
│   ├── proxy-logs/page.tsx    ← Proxy logs: journalctl -u primordia-proxy; live tail; admin only
│   ├── rollback/{page.tsx,AdminRollbackClient.tsx} ← Deep rollback from productionHistory; admin only
│   ├── server-health/{page.tsx,AdminServerHealthClient.tsx} ← Disk/memory usage + worktree cleanup; admin only
│   ├── updates/{page.tsx,UpdatesClient.tsx} ← Upstream update sources fetch/merge; admin only
│   └── events/{page.tsx,EventsClient.tsx} ← Event log viewer: paginated, filterable table of all tracked user events; admin only
├── api-docs/
│   ├── layout.tsx             ← Thin server layout for /api-docs; exports page metadata (client page can't export metadata directly)
│   └── page.tsx               ← Interactive API reference UI powered by @scalar/api-reference-react; loads spec from /api/openapi
├── evolve/
│   ├── page.tsx               ← Dedicated "propose a change" page; renders <EvolveRequestForm>; requires evolve permission
│   ├── EvolveForm.tsx         ← Client component: the submit-a-request form body rendered at /evolve
│   └── session/[id]/
│       ├── page.tsx               ← Session-tracking page; publicly viewable; passes canEvolve to hide actions for non-evolvers
│       ├── EvolveSessionView.tsx  ← Client component: streams live session progress via SSE; shows preview, diffs, actions
│       ├── DiffFileExpander.tsx   ← Expandable file row in git diff summary table; lazy-loads colorized diffs
│       ├── HorizontalResizeHandle.tsx ← Drag handle for resizing two-panel horizontal flex layouts
│       └── WebPreviewPanel.tsx    ← Inline browser-like preview panel with Back/Forward/Refresh and element inspector mode
├── install.sh/route.ts        ← Returns install.sh script with origins/base paths rewritten for the current instance
├── login/
│   ├── page.tsx               ← Server component: auto-discovers providers via readdirSync(lib/auth-providers/); passes to LoginClient
│   ├── LoginClient.tsx        ← Client component: renders one tab per provider; loads tab components via next/dynamic
│   ├── approve/page.tsx       ← Approval page: authenticated device approves a QR cross-device sign-in
│   └── cross-device-receive/page.tsx ← Receive page: new device scanning QR completes cross-device push sign-in flow
└── schemas/instance/v1.json/route.ts ← Serves the JSON Schema for Primordia instance manifests
```
