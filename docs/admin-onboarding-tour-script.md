# Onboarding Tour — Script for Product Tour

> This script is the source of truth for building the in-app product tour shown to users
> the first time they land on the home page with the `can_evolve` role. Admin-specific steps
> are included at the end and are gated on whether the current user has the `admin` role.
>
> **Format conventions:**
> - Each step has an **anchor** — the page URL and element to highlight.
> - `[TOOLTIP: ...]` — text shown in the tour bubble.
> - `[ADVANCE: ...]` — the user action (or auto-trigger) that moves to the next step.
> - `[EVENT: ...]` — analytics event that fires at this step (for future instrumentation).
> - Steps marked `[SKIP IF: ...]` are conditional and may be omitted based on runtime state.
> - Steps marked `[ADMIN ONLY]` are shown only to users with the `admin` role.

---

## Preface: When does this tour fire?

The tour fires **once**, immediately after a user with the `can_evolve` role lands on the home page for the first time. A `tourCompleted` flag in the user's DB record suppresses it on future visits. Users who gain `can_evolve` after initial registration will see the tour on their next page load.

The first user to register is automatically granted both `admin` and `can_evolve`, so they see the full tour including the admin-only steps at the end.

---

## Act 1: Welcome

### Step 1 — Welcome overlay

- **Anchor:** `/` — full-screen modal overlay (no element highlight)
- **[TOOLTIP]:** _(admin variant — shown if user has `admin` role)_
  > **Welcome to Primordia.**
  >
  > You're the first user on this instance, so you've been given the **admin** role automatically.
  >
  > This quick tour covers:
  > 1. How to set up your AI credentials
  > 2. How to propose changes to the app using AI
  > 3. Admin tools for managing users and the server
  >
  > Takes about 2 minutes. You can skip any time.
- **[TOOLTIP]:** _(non-admin variant — shown if user only has `can_evolve`)_
  > **Welcome to Primordia.**
  >
  > You have access to the **Evolve** feature — you can propose changes to this app in plain English, and an AI agent will build and preview them for you.
  >
  > This quick tour covers:
  > 1. How to set up your AI credentials
  > 2. How to propose a change and review the result
  >
  > Takes about 90 seconds. You can skip any time.
- **[ADVANCE]:** "Start tour" button or "Skip" link
- **[EVENT]:** `tour/started/v1 {userId: "...", isAdmin: true|false}`

---

## Act 2: The Home Page

### Step 2 — Landing page orientation

- **Anchor:** `/` — highlight the main hero/heading area
- **[TOOLTIP]:**
  > This is the **home page** — a live, running web app.
  >
  > Everything you see is editable. Users with access can describe a change in plain English and an AI agent builds it, live, in a private preview.
- **[ADVANCE]:** "Next" button

### Step 3 — The hamburger menu

- **Anchor:** `/` — highlight the `☰` button in the top-right nav
- **[TOOLTIP]:**
  > The **☰ menu** is how you access all of Primordia's features.
  >
  > Click it to see what's inside.
- **[ADVANCE]:** User clicks the hamburger (or "Next" after a 3 s delay)
- **[EVENT]:** `nav/menu-toggled/v1 {open: true}` (existing event — reuse)

### Step 4 — Menu overview

- **Anchor:** `/` — hamburger menu open, highlight the menu panel as a whole
- **[TOOLTIP]:**
  > From here you can propose changes, manage your credentials, and more.
  >
  > First, let's set up your **AI credentials** — that's what powers the AI agent that builds your changes.
- **[ADVANCE]:** "Next" button (do not navigate yet)

### Step 5 — Close the menu

- **[TOOLTIP]:** _(no bubble)_
- **[ADVANCE]:** Auto-advance; close menu, open the Credentials modal (or navigate to the credentials section)

---

## Act 3: Credentials

> This act walks the user through the three ways to power the AI agent. Each option gets its own
> step. The user doesn't need to configure anything right now — the goal is awareness.
>
> **Navigation:** close the hamburger, then open ☰ → "Account Settings" (navigates to `/settings`).
> The page has two tabs in the sidebar: **API Keys** (`/settings`) and **Claude.ai Subscription** (`/settings/claude-ai`).
> Steps 6–8 live on the API Keys tab; Step 9 switches to the Claude.ai tab.

### Step 6 — Account Settings / credential sources

- **Anchor:** `/settings` — highlight the API Keys page header
- **[TOOLTIP]:**
  > This is **Account Settings** — where you save AI credentials that can power Evolve.
  >
  > Credentials are not ordered globally. Each Evolve preset chooses one billing source explicitly: Claude.ai, an API key, ChatGPT, OpenRouter, or the exe.dev gateway.
  >
  > You only need to configure the sources you want to use in presets.
- **[ADVANCE]:** "Next" button

### Step 7 — Option 1: exe.dev gateway (zero-config)

- **Anchor:** `/settings/presets` — highlight the built-in exe.dev gateway preset
  - `[SKIP IF: instance is not hosted on exe.dev]`
- **[TOOLTIP]:**
  > **Already set up — nothing to do.**
  >
  > Because you're on exe.dev, you can pick an exe.dev gateway preset without storing a credential. Your Shelley tokens are used only when that preset is selected.
  >
  > _(Future: show remaining Shelley token balance here once the exe.dev API exposes it.)_
- **[ADVANCE]:** "Next" button

### Step 8 — Option 2: OpenRouter (free tier)

- **Anchor:** `/settings` — highlight the **OpenRouter** card (violet, monogram "OR")
- **[TOOLTIP]:**
  > **Free option: OpenRouter.**
  >
  > OpenRouter has a free tier with capable open-source coding models — no credit card needed. Get a key at **openrouter.ai/keys** (the "Get a key" link is right on the card), paste it in, and hit **Save key**.
  >
  > Your key starts with `sk-or-v1-`. Use it by selecting an OpenRouter preset in Evolve.
- **[ADVANCE]:** "Next" button

### Step 9 — Option 3: Claude.ai subscription

- **Anchor:** `/settings/claude-ai` — switch to the Claude.ai tab; highlight the **"Sign in with Claude.ai"** button (sky blue, full-width)
- **[TOOLTIP]:**
  > **Have a Claude.ai Pro or Max plan?**
  >
  > Click **"Sign in with Claude.ai"** to go through a quick OAuth flow. Primordia will use your existing subscription — no separate API bill.
  >
  > On Linux, you can also paste the contents of `~/.claude/.credentials.json` directly using the "Paste credentials file manually" section below the button.
  >
  > Credentials are encrypted in your browser before storage — the key never leaves your device.
- **[ADVANCE]:** "Next" button (do not start the auth flow during the tour)

### Step 10 — Credentials wrap-up / segue

- **Anchor:** `/settings/claude-ai` — no highlight
- **[TOOLTIP]:**
  > That's it for credentials. Come back to Account Settings any time from the ☰ menu to update saved sources, then choose among them with Evolve presets.
  >
  > Now let's see what you can actually do with it.
- **[ADVANCE]:** "Next" button; navigate back to `/`

---

## Act 4: The Evolve Flow

### Step 11 — Open evolve entry point

- **Anchor:** `/` — highlight the `☰` button
- **[TOOLTIP]:**
  > Open the menu and click **"Propose a change"** to start.
- **[ADVANCE]:** User opens menu and clicks "Propose a change" — or "Next" after 4 s delay
- **[EVENT]:** `evolve-dialog/opened/v1 {}` (existing event — reuse, or detect it as advance trigger)

### Step 12 — The evolve form

- **Anchor:** evolve dialog (floating or `/evolve` page) — highlight the text area
- **[TOOLTIP]:**
  > **Describe what you want** in plain English — as specific or as vague as you like.
  >
  > _Example: "Add a dark mode toggle to the nav bar."_
  >
  > The AI agent reads your request, looks at the codebase, writes the code, and builds a live preview.
- **[ADVANCE]:** "Next" button (do not submit)

### Step 13 — Attachments & element inspector

- **Anchor:** evolve dialog — highlight the "Attach files" button and the crosshair/inspector button
- **[TOOLTIP]:**
  > You can also **attach screenshots or files** as reference, or use the **element inspector** (crosshair) to click on any part of the page and add it as context.
  >
  > Both help the AI understand exactly what you mean.
- **[ADVANCE]:** "Next" button

### Step 14 — Submit & wait

- **Anchor:** evolve dialog — highlight the "Propose Change" submit button
- **[TOOLTIP]:**
  > When you hit **Propose Change**, Primordia:
  > 1. Creates a private git branch
  > 2. Runs the AI agent on it
  > 3. Starts a dev server with the result
  >
  > You'll land on a session page where you can watch it work in real time.
- **[ADVANCE]:** "Next" button (do not submit during tour)

### Step 15 — Session page overview

- **Anchor:** `/` — overlay illustration or screenshot placeholder (user hasn't submitted, so show a static callout)
- **[TOOLTIP]:**
  > On the **session page** you'll see:
  > - Live agent output as it writes code
  > - A side-by-side preview of the running change
  > - A diff of every file touched
  >
  > When you're happy, click **Accept** to deploy it instantly. Not happy? Click **Reject** — the branch is discarded cleanly.
- **[ADVANCE]:** "Next" button

### Step 16 — Close evolve dialog / segue to admin

- **[TOOLTIP]:** _(no bubble — close dialog programmatically)_
- **[ADVANCE]:** Auto-advance
  - If user is **not** admin → skip to Step 22 (wrap-up)
  - If user **is** admin → continue to Act 5

---

## Act 5: Admin Tools _(Admin only — skip entire act if user lacks `admin` role)_

### Step 17 — Navigate to admin panel

- **[TOOLTIP]:** _(no bubble — navigate to `/admin`)_
- **[ADVANCE]:** Auto-advance

### Step 18 — Admin panel landing

- **Anchor:** `/admin` — highlight the page heading / user + role list
- **[TOOLTIP]:**
  > This is the **Admin panel** — only admins can see it.
  >
  > From here you manage users and roles. New users start with no roles; you decide who gets `can_evolve` access.
- **[ADVANCE]:** "Next" button

### Step 19 — Granting the can_evolve role

- **Anchor:** `/admin` — highlight the `can_evolve` role grant controls
- **[TOOLTIP]:**
  > To let someone propose changes, give them **`can_evolve`**.
  >
  > You can revoke it the same way. Admins automatically have it.
- **[ADVANCE]:** "Next" button

### Step 20 — Key admin tools (overview)

- **Anchor:** `/admin` — highlight the sidebar/nav links as a group
- **[TOOLTIP]:**
  > A few tools worth knowing:
  >
  > - **Server health** — disk & memory usage; clean up old preview worktrees
  > - **Logs** — live stdout/stderr stream from the production process
  > - **Rollback** — one-click revert to any previous deployment, zero downtime
  > - **Updates** — pull upstream Primordia improvements without touching the terminal
- **[ADVANCE]:** "Next" button

### Step 21 — End of admin section

- **[TOOLTIP]:** _(no bubble — navigate back to `/`)_
- **[ADVANCE]:** Auto-advance → Step 22

---

## Act 6: Wrap-up

### Step 22 — Tour complete

- **Anchor:** `/` — full-screen modal overlay (no element highlight)
- **[TOOLTIP]:** _(admin variant)_
  > **You're all set.**
  >
  > - Credentials live in ☰ → Credentials — update any time
  > - Propose changes via ☰ → "Propose a change"
  > - Manage users and the server at `/admin`
  >
  > The tour won't show again, but everything's always one menu click away.
- **[TOOLTIP]:** _(non-admin variant)_
  > **You're all set.**
  >
  > - Credentials live in ☰ → Credentials — update any time
  > - Propose changes any time via ☰ → "Propose a change"
  >
  > The tour won't show again. Go break something — in a good way.
- **[ADVANCE]:** "Done" button
- **[EVENT]:** `tour/completed/v1 {userId: "...", isAdmin: true|false, skipped: false}`

---

## Skip / Dismiss Path

If the user clicks "Skip" at any step:
- **[EVENT]:** `tour/skipped/v1 {userId: "...", atStep: N, isAdmin: true|false}`
- Mark `tourCompleted = true` in DB immediately
- Dismiss overlay/tooltip, return user to current page
- No re-trigger on next login

---

## Open Questions (resolve before building)

| # | Question | Notes |
|---|---|---|
| 1 | **Tooltip library?** | Shepherd.js, Intro.js, or custom? Custom keeps dependencies minimal. |
| 2 | **Highlight style?** | Spotlight (darken surround) vs. outline ring vs. arrow pointer bubble? |
| 3 | **Shelley token balance** — can we fetch remaining exe.dev Shelley tokens and display them in Step 7? | Check exe.dev API docs; add to Step 7 once supported. |
| 4 | **Credentials navigation** — tour navigates to `/settings` then `/settings/claude-ai`; confirm the sidebar tab switch can be triggered programmatically (or just navigate via URL). | |
| 5 | **Step 16 branching** — admin vs. non-admin path needs a runtime role check at that point; simplest is to embed `isAdmin` in the tour config rendered server-side. | |
| 6 | **exe.dev detection for Step 7** — detect via `NEXT_PUBLIC_BASE_PATH`, env var, or a runtime flag? | Prefer an env flag set by the installer. |
| 7 | **Steps 11–15 (evolve flow)** — tour talks about the form without submitting; consider whether a short looping GIF or screenshot would make Step 15 (session page) clearer since the user hasn't seen it yet. | |
| 8 | **Mobile?** — hamburger and floating dialog steps work on desktop; mobile may need a simplified flow. | Defer mobile variant until desktop is validated. |
| 9 | **Progress indicator** — numbered dots, "Step N of 22", or none? | Numbered dots; total count should reflect actual steps shown (varies by admin/exe.dev). |
| 10 | **Auto-advance timeout** — should any step auto-advance after N seconds? | Risk: user is reading. Prefer explicit "Next" for all steps except the silent transition steps. |
