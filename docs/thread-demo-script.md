# Thread Feature — Demo Script for Instructional Video

> Each `[EVENT: ...]` annotation shows the user event that fires at that moment.
> After the script, see the **Gap Analysis** for coverage assessment.

---

## Act 1: Opening the Thread Form

1. **Land on the home page** (`/`)
   - _(No event — page-view tracking not yet implemented for landing page)_
   - Camera shows the marketing page, scrolls briefly

2. **Open the hamburger menu** (☰ top-right)
   - `[EVENT: nav/menu-toggled/v1 {open: true}]`
   - Menu slides open showing user options

3. **Click "Propose a change"**
   - `[EVENT: nav/menu-item-clicked/v1 {dataId: "nav-menu/propose-change", label: "Propose a change"}]`
   - `[EVENT: thread-dialog/opened/v1 {}]`
   - Floating dialog appears, can be dragged/docked

4. **Type a request**: _"Add a dark mode toggle to the nav bar"_
   - No event fires (no keystroke tracking — good for privacy)
   - Narrator explains the text area

## Act 2: Attachments & Advanced Options

5. **Click "Attach files"** button
   - `[EVENT: thread-form/attach-files-clicked/v1 {}]`
   - File picker opens

6. **Select 2 image files** (mockup screenshots)
   - `[EVENT: thread-form/files-attached/v1 {count: 2, trigger: "input"}]`
   - File chips appear below the textarea

7. **Remove one file** (click ✕ on chip)
   - `[EVENT: thread-form/file-removed/v1 {name: "mockup-v1.png", trigger: "mouse"}]`

8. **Open the element inspector** (crosshair button)
   - `[EVENT: thread-form/element-inspector-opened/v1 {}]`
   - Full-screen overlay activates, user hovers elements

9. **Pick an element** (click on the nav bar)
   - `[EVENT: thread-form/element-picked/v1 {component: "NavHeader", selector: "[data-id=\"nav-header\"]"}]`
   - Element context chip appears in form

10. **Toggle Advanced Options** (expand section)
    - `[EVENT: thread-form/advanced-toggled/v1 {open: true}]`
    - Shows harness/model selectors

11. **Change harness** to "pi"
    - `[EVENT: thread-form/harness-changed/v1 {harness: "pi", model: "..."}]`

12. **Change model** to a specific option
    - `[EVENT: thread-form/model-changed/v1 {model: "claude-sonnet-4-20250514", harness: "pi"}]`

13. **Enable caveman mode** (checkbox)
    - `[EVENT: thread-form/caveman-toggled/v1 {enabled: true}]`

14. **Change caveman intensity** to "ultra"
    - `[EVENT: thread-form/caveman-intensity-changed/v1 {intensity: "ultra"}]`

## Act 3: Submit & Watch Progress

15. **Click "Propose Change"** (submit button)
    - `[EVENT: thread-form/submit/v1 {harness: "pi", model: "...", hasFiles: true, fileCount: 1, hasElementAttachments: true, elementAttachmentCount: 1}]`
    - Loading spinner, then redirect

16. **Arrive at thread page** (`/thread/{id}`)
    - `[EVENT: session/page-viewed/v1 {sessionId: "...", status: "starting"}]`
    - Shows "Creating branch…" with setup steps

17. **Watch setup steps complete** (bun install, worktree creation)
    - No client event — server-side setup, progress via SSE
    - Narrator explains the pipeline

18. **Claude starts working** (status → running-claude)
    - `[EVENT: session/status-changed/v1 {sessionId: "...", from: "starting", to: "running-claude"}]`
    - Progress section streams tool calls + text output

19. **Claude finishes** (status → ready)
    - `[EVENT: session/status-changed/v1 {sessionId: "...", from: "running-claude", to: "ready"}]`
    - Preview panel appears on wide screens

## Act 4: Reviewing the Preview

20. **Preview loads in sidebar** (WebPreviewPanel appears)
    - `[EVENT: session/preview-loaded/v1 {sessionId: "...", previewUrl: "..."}]`
    - Narrator points out the inline browser

21. **Click Back in preview toolbar**
    - `[EVENT: preview/back-clicked/v1 {sessionId: "..."}]`

22. **Click Forward in preview toolbar**
    - `[EVENT: preview/forward-clicked/v1 {sessionId: "..."}]`

23. **Click Refresh in preview toolbar**
    - `[EVENT: preview/refresh-clicked/v1 {sessionId: "..."}]`

24. **Edit URL bar and navigate**
    - `[EVENT: preview/url-navigated/v1 {sessionId: "...", url: "..."}]`

25. **Click "Open in new tab"**
    - `[EVENT: preview/open-in-new-tab/v1 {sessionId: "..."}]`

26. **Toggle element inspector in preview**
    - `[EVENT: preview/inspector-toggled/v1 {sessionId: "...", active: true}]`
    - Crosshair mode activates inside iframe

27. **Pick element from preview** (clicks on something)
    - `[EVENT: session/preview-element-selected/v1 {sessionId: "...", component: "...", selector: "..."}]`
    - Follow-up tab auto-opens with element context

## Act 5: Diffs & Follow-up

28. **Toggle "Files changed" section**
    - `[EVENT: session/diff-summary-toggled/v1 {sessionId: "...", fileCount: 5}]`
    - Shows file list with +/- counts

29. **Expand a diff file** (click on filename row)
    - `[EVENT: session/diff-file-toggled/v1 {sessionId: "...", file: "components/NavHeader.tsx", open: true}]`
    - Colorized unified diff loads inline

30. **Click "Follow-up Changes" tab**
    - `[EVENT: session/action-panel-toggled/v1 {action: "followup", open: true, sessionId: "..."}]`
    - Follow-up form appears with element context chip

31. **Type follow-up request**: _"Make the toggle icon larger"_
    - No event

32. **Submit follow-up**
    - `[EVENT: thread-form/submit/v1 {harness: "...", model: "...", ...}]`
    - `[EVENT: session/followup-submitted/v1 {sessionId: "...", harness: "...", model: "...", hasFiles: false, hasElementContext: true}]`
    - Status goes back to running-claude

33. **Claude finishes follow-up** (status → ready again)
    - `[EVENT: session/status-changed/v1 {sessionId: "...", from: "running-claude", to: "ready"}]`

## Act 6: Accept or Reject

34. **Click "Accept Changes" tab**
    - `[EVENT: session/action-panel-toggled/v1 {action: "accept", open: true, sessionId: "..."}]`
    - Accept panel shows deployment description

35. **Click "Confirm" (accept)**
    - `[EVENT: session/accept-clicked/v1 {sessionId: "..."}]`
    - Status → accepting → accepted
    - Narrator explains blue/green deploy

36. **Session accepted** (status → accepted)
    - `[EVENT: session/status-changed/v1 {sessionId: "...", from: "accepting", to: "accepted"}]`
    - Green "Changes deployed" banner appears

---

## Alternative: Reject Flow

34b. **Click "Reject Changes" tab**
    - `[EVENT: session/action-panel-toggled/v1 {action: "reject", open: true, sessionId: "..."}]`

35b. **Click "Confirm" (reject)**
    - `[EVENT: session/reject-clicked/v1 {sessionId: "..."}]`
    - Branch and worktree discarded

---

## Bonus: Utility Actions

- **Copy branch name**: `[EVENT: session/branch-name-copied/v1 {branch: "..."}]`
- **Abort running agent**: `[EVENT: session/abort-clicked/v1 {sessionId: "..."}]`
- **Restart dev server**: `[EVENT: session/restart-server-clicked/v1 {sessionId: "..."}]`
- **Apply upstream updates**: `[EVENT: session/upstream-sync-clicked/v1 {sessionId: "..."}]`

---

## Gap Analysis: Could events alone drive the demo video?

### What's covered ✅

- **Navigation**: hamburger menu open/close, menu item clicks, thread dialog opened
- **Form interactions**: file attach/remove, element pick, advanced toggle, harness/model change, caveman toggle
- **Form submit**: initial submit with full metadata (harness, model, file count, element attachments)
- **Session page viewed**: fires on mount with sessionId + initial status
- **Session status transitions**: every status change (starting→running→ready→accepting→accepted) with from/to
- **Preview loaded**: fires when previewUrl first becomes available
- **Preview panel**: back, forward, refresh, URL navigate, open-in-new-tab, inspector toggle
- **Preview element selection**: component + selector from iframe inspector
- **Diff interactions**: summary section toggled, individual file expand/collapse with filename
- **Follow-up submitted**: distinct event from initial submit, includes harness/model/element context
- **Session actions**: accept, reject, abort, restart server, upstream-sync, branch-name-copy
- **Action panel toggles**: follow-up/accept/reject tabs

### Remaining gaps (acceptable)

| Gap | Why it's OK |
|-----|-------------|
| **No page-view for `/` or `/thread`** | Entry point, not the thread detail feature. Add later for full-app coverage. |
| **No keystroke/typing events** | Privacy-respecting by design. Content visible in session NDJSON. |
| **No SSE streaming progress events** | Server-side session NDJSON captures all agent activity. |
| **Floating dialog drag/dock/close** | Nice-to-have, not critical for video reconstruction. |

### Verdict

**Yes — events can now drive the demo video.** Every major act produces at least one event:

| Act | Key events |
|-----|------------|
| 1. Open thread form | `nav/menu-toggled`, `nav/menu-item-clicked`, `thread-dialog/opened` |
| 2. Attachments & options | `thread-form/attach-files-clicked`, `files-attached`, `element-picked`, `advanced-toggled`, `harness-changed`, `model-changed` |
| 3. Submit & watch | `thread-form/submit`, `session/page-viewed`, `session/status-changed` (×3: starting→running→ready) |
| 4. Review preview | `session/preview-loaded`, `preview/back-clicked`, `preview/refresh-clicked`, `preview/inspector-toggled`, `session/preview-element-selected` |
| 5. Diffs & follow-up | `session/diff-summary-toggled`, `session/diff-file-toggled`, `session/action-panel-toggled`, `session/followup-submitted`, `session/status-changed` |
| 6. Accept/reject | `session/action-panel-toggled`, `session/accept-clicked`, `session/status-changed` (→accepted) |

Event stream provides enough signal to reconstruct timing, sequence, and intent of every user interaction in the thread workflow.
