/**
 * Playwright script faithfully executing the thread-demo-script.md steps.
 *
 * Prerequisites:
 *   - Dev server running at BASE_URL (default: http://localhost:3000)
 *   - User must be logged in and have the `can_evolve` role
 *   - Set PLAYWRIGHT_BASE_URL env var to override the default
 *
 * Run: bunx playwright test tests/thread-demo.spec.ts --headed
 */

import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Timeouts for the slow async steps
const T = {
  /** UI interactions — element should already be in the DOM */
  ui: 5_000,
  /** Dialog/animation — brief render delay after a user action */
  dialog: 3_000,
  /** Toast appears after a network round-trip */
  toast: 15_000,
  /** Page navigation after clicking a link */
  nav: 15_000,
  /** Worktree setup + bun install before Claude starts */
  worktreeSetup: 90_000,
  /** Claude agent running (initial pass) — typical 3-5 min for a real change */
  claudeRun: 8 * 60_000,
  /** Claude agent running (follow-up pass) — usually shorter than initial */
  claudeFollowup: 5 * 60_000,
  /** Preview dev server coming up after Claude finishes */
  previewReady: 60_000,
  /** Blue/green deploy pipeline after Accept */
  deploy: 5 * 60_000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tiny mock image file for attach-files tests. */
function createTempImages(): string[] {
  const dir = path.join(__dirname, ".tmp-attachments");
  fs.mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const name of ["mockup-v1.png", "mockup-v2.png"]) {
    const p = path.join(dir, name);
    // 1×1 transparent PNG (minimal valid PNG bytes)
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
        "1f15c4890000000a4944415478016360000000020001e221bc330000000049454e44ae426082",
      "hex"
    );
    fs.writeFileSync(p, png);
    paths.push(p);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("Thread demo script", () => {
  let sessionId: string;
  let imagePaths: string[];

  test.beforeAll(() => {
    imagePaths = createTempImages();
  });

  test.afterAll(() => {
    // Clean up temp images
    for (const p of imagePaths) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  });

  test("full thread demo flow", async ({ page, context }) => {
    // -----------------------------------------------------------------------
    // Act 1: Opening the thread form
    // -----------------------------------------------------------------------

    // Step 1 — Land on home page
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    // Scroll briefly (mirrors the camera pan in the video)
    await page.evaluate(() => window.scrollBy({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await page.waitForTimeout(400);

    // Step 2 — Open hamburger menu
    // EVENT: nav/menu-toggled/v1 {open: true}
    await page.click('[data-id="nav/menu-toggle"]');
    await expect(page.locator('[data-id="nav-menu/propose-change"]')).toBeVisible({ timeout: T.ui });

    // Step 3 — Click "Propose a change"
    // EVENT: nav/menu-item-clicked/v1 {dataId: "nav-menu/propose-change", label: "Propose a change"}
    // EVENT: thread-dialog/opened/v1 {}
    await page.click('[data-id="nav-menu/propose-change"]');

    // Wait for the floating thread dialog to appear
    const requestInput = page.locator('[data-id="thread/request-input"]');
    await expect(requestInput).toBeVisible({ timeout: T.dialog });

    // Step 4 — Type a request
    await requestInput.fill("Add a dark mode toggle to the nav bar");

    // -----------------------------------------------------------------------
    // Act 2: Attachments & advanced options
    // -----------------------------------------------------------------------

    // Step 5 — Click "Attach files"
    // EVENT: thread-form/attach-files-clicked/v1 {}
    // Use setInputFiles directly on the hidden <input type="file"> because
    // Playwright can't interact with OS file pickers.
    await page.click('[data-id="thread/attach-files"]');

    // Step 6 — Select 2 image files
    // EVENT: thread-form/files-attached/v1 {count: 2, trigger: "input"}
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(imagePaths);

    // Verify both chips appear
    await expect(page.locator('text="mockup-v1.png"')).toBeVisible({ timeout: T.ui });
    await expect(page.locator('text="mockup-v2.png"')).toBeVisible({ timeout: T.ui });

    // Step 7 — Remove one file (click ✕ on the first chip)
    // EVENT: thread-form/file-removed/v1 {name: "mockup-v1.png", trigger: "mouse"}
    const removeButtons = page.locator('[data-id="thread/remove-file-attachment"]');
    await removeButtons.first().click();
    await expect(page.locator('text="mockup-v1.png"')).not.toBeVisible({ timeout: T.ui });

    // Step 8 — Open element inspector
    // EVENT: thread-form/element-inspector-opened/v1 {}
    await page.click('[data-id="thread/pick-element"]');

    // Full-screen overlay activates; wait for it to appear
    await page.waitForTimeout(500);

    // Step 9 — Pick an element (nav header)
    // EVENT: thread-form/element-picked/v1 {component: "NavHeader", selector: "[data-id=\"nav-header\"]"}
    // Click on an element that has data-id="nav-header" in the overlay
    const navHeader = page.locator('[data-id="nav-header"]').first();
    if (await navHeader.isVisible()) {
      await navHeader.click();
    } else {
      // Fallback: press Escape to dismiss and skip element pick gracefully
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(400);

    // Step 10 — Toggle Advanced Options
    // EVENT: thread-form/advanced-toggled/v1 {open: true}
    await page.click('[data-id="thread/advanced-toggle"]');
    await expect(page.locator('[data-id="thread/harness-select"]')).toBeVisible({ timeout: T.dialog });

    // Step 11 — Change harness to "pi"
    // EVENT: thread-form/harness-changed/v1 {harness: "pi", model: "..."}
    await page.selectOption('[data-id="thread/harness-select"]', "pi");

    // Step 12 — Change model
    // EVENT: thread-form/model-changed/v1 {model: "claude-sonnet-4-20250514", harness: "pi"}
    const modelSelect = page.locator('[data-id="thread/model-select"]');
    await modelSelect.waitFor({ state: "visible" });
    // Pick the first available option (exact model IDs depend on the registry)
    const firstModelOption = modelSelect.locator("option").nth(1);
    const modelValue = await firstModelOption.getAttribute("value");
    if (modelValue) {
      await modelSelect.selectOption(modelValue);
    }

    // Step 13 — Enable caveman mode
    // EVENT: thread-form/caveman-toggled/v1 {enabled: true}
    const cavemanCheckbox = page.locator('[data-id="thread/caveman-mode"]');
    if (await cavemanCheckbox.isVisible()) {
      await cavemanCheckbox.check();
    }

    // Step 14 — Change caveman intensity to "ultra"
    // EVENT: thread-form/caveman-intensity-changed/v1 {intensity: "ultra"}
    const cavemanIntensity = page.locator('[data-id="thread/caveman-intensity"]');
    if (await cavemanIntensity.isVisible()) {
      await cavemanIntensity.selectOption("ultra");
    }

    // -----------------------------------------------------------------------
    // Act 3: Submit & watch progress
    // -----------------------------------------------------------------------

    // Step 15 — Click "Propose Change" / submit
    // EVENT: thread-form/submit/v1 {harness: "pi", model: "...", hasFiles: true, fileCount: 1, ...}
    const submitBtn = page.locator('[data-id="thread/submit-request"]');
    await expect(submitBtn).toBeEnabled({ timeout: T.ui });
    await submitBtn.click();

    // The floating dialog closes and shows a toast with a "View session" link.
    // Click it to navigate to the session page.
    const viewSessionLink = page.locator('[data-id="thread-dialog/view-session"]');
    await expect(viewSessionLink).toBeVisible({ timeout: T.toast });
    await viewSessionLink.click();

    // Step 16 — Arrive at session page
    // EVENT: session/page-viewed/v1 {sessionId: "...", status: "starting"}
    await page.waitForURL(/\/thread\//, { timeout: T.nav });
    sessionId = page.url().split("/thread/")[1].split("?")[0];
    expect(sessionId).toBeTruthy();

    // Step 17 — Watch setup steps (bun install, worktree creation) — no client event
    // Just wait for the session to move past "starting"; swallow if already transitioned.
    await expect(page.locator('text="Creating branch"')).toBeVisible({ timeout: T.worktreeSetup }).catch(() => {});

    // Step 18 — Claude starts working (status → running-claude)
    // EVENT: session/status-changed/v1 {from: "starting", to: "running-claude"}
    // Swallow: by the time we check, Claude may already be done.
    await expect(page.locator('text="running-claude"')).toBeVisible({ timeout: T.worktreeSetup }).catch(() => {});

    // Step 19 — Claude finishes (status → ready)
    // EVENT: session/status-changed/v1 {from: "running-claude", to: "ready"}
    await expect(page.locator('[data-id="session/tab-accept"]')).toBeVisible({ timeout: T.claudeRun });

    // -----------------------------------------------------------------------
    // Act 4: Reviewing the preview
    //
    // The preview panel only appears when proxyServerStatus === 'running',
    // which requires the reverse proxy (scripts/reverse-proxy.ts) to be
    // running with REVERSE_PROXY_PORT set. When testing against a plain
    // `bun run dev` the panel never renders, so this block is best-effort.
    // -----------------------------------------------------------------------

    // Step 20 — Preview loads in sidebar
    // EVENT: session/preview-loaded/v1 {sessionId: "...", previewUrl: "..."}
    const previewPanel = page.locator('[data-id="preview/url-bar"]');
    const previewAvailable = await previewPanel.isVisible({ timeout: T.previewReady }).catch(() => false);

    if (previewAvailable) {
      // Step 21 — Click Back in preview toolbar
      // EVENT: preview/back-clicked/v1 {sessionId: "..."}
      await page.click('[data-id="preview/back"]');

      // Step 22 — Click Forward in preview toolbar
      // EVENT: preview/forward-clicked/v1 {sessionId: "..."}
      await page.click('[data-id="preview/forward"]');

      // Step 23 — Click Refresh in preview toolbar
      // EVENT: preview/refresh-clicked/v1 {sessionId: "..."}
      await page.click('[data-id="preview/refresh"]');

      // Step 24 — Edit URL bar and navigate
      // EVENT: preview/url-navigated/v1 {sessionId: "...", url: "..."}
      const urlBar = page.locator('[data-id="preview/url-bar"]');
      await urlBar.click({ clickCount: 3 }); // select all
      await urlBar.type("/");
      await urlBar.press("Enter");

      // Step 25 — Open in new tab
      // EVENT: preview/open-in-new-tab/v1 {sessionId: "..."}
      const [newTab] = await Promise.all([
        context.waitForEvent("page"),
        page.click('[data-id="preview/open-in-new-tab"]'),
      ]);
      await newTab.close();

      // Step 26 — Toggle element inspector in preview
      // EVENT: preview/inspector-toggled/v1 {sessionId: "...", active: true}
      const inspectorToggle = page.locator('[data-id="preview/inspector-toggle"]');
      if (await inspectorToggle.isVisible()) {
        await inspectorToggle.click();
        await page.waitForTimeout(500);

        // Step 27 — Pick element from preview (click something inside the iframe)
        // EVENT: session/preview-element-selected/v1 {sessionId: "...", component: "...", selector: "..."}
        const iframe = page.frameLocator("iframe").first();
        const iframeBody = iframe.locator("body");
        if (await iframeBody.isVisible({ timeout: T.dialog }).catch(() => false)) {
          await iframeBody.click({ position: { x: 100, y: 100 } });
        }
        await page.waitForTimeout(500);
      }
    } else {
      console.log("[test] Preview panel not available (reverse proxy not running) — skipping Act 4 preview steps.");
    }

    // -----------------------------------------------------------------------
    // Act 5: Diffs & follow-up
    // -----------------------------------------------------------------------

    // Step 28 — Toggle "Files changed" section
    // EVENT: session/diff-summary-toggled/v1 {sessionId: "...", fileCount: 5}
    const diffToggle = page.locator('text="Files changed"').first();
    if (await diffToggle.isVisible({ timeout: T.ui }).catch(() => false)) {
      await diffToggle.click();

      // Step 29 — Expand a diff file
      // EVENT: session/diff-file-toggled/v1 {sessionId: "...", file: "...", open: true}
      const firstDiffFile = page.locator('[data-id="diff/file-toggle"]').first();
      if (await firstDiffFile.isVisible({ timeout: T.dialog }).catch(() => false)) {
        await firstDiffFile.click();
        await page.waitForTimeout(500);
        // Collapse it again to be tidy
        await firstDiffFile.click();
      }
    }

    // Step 30 — Click "Follow-up Changes" tab
    // EVENT: session/action-panel-toggled/v1 {action: "followup", open: true, sessionId: "..."}
    await page.click('[data-id="session/tab-followup"]');
    await expect(page.locator('[data-id="thread/request-input"]').last()).toBeVisible({ timeout: T.dialog });

    // Step 31 — Type follow-up request
    await page.locator('[data-id="thread/request-input"]').last().fill("Make the toggle icon larger");

    // Step 32 — Submit follow-up
    // EVENT: thread-form/submit/v1 {...}
    // EVENT: session/followup-submitted/v1 {sessionId: "...", ...}
    await page.locator('[data-id="thread/submit-request"]').last().click();

    // Step 33 — Claude finishes follow-up (status → ready again)
    // EVENT: session/status-changed/v1 {from: "running-claude", to: "ready"}
    await expect(page.locator('[data-id="session/tab-accept"]')).toBeVisible({ timeout: T.claudeFollowup });

    // -----------------------------------------------------------------------
    // Act 6: Accept
    // -----------------------------------------------------------------------

    // Step 34 — Click "Accept Changes" tab
    // EVENT: session/action-panel-toggled/v1 {action: "accept", open: true, sessionId: "..."}
    // Note: confirm-accept only renders when canAcceptReject is true, which
    // requires the dev server to be checked out on the session's parent branch.
    await page.click('[data-id="session/tab-accept"]');
    const confirmAccept = page.locator('[data-id="session/confirm-accept"]');
    const canConfirm = await confirmAccept.isVisible({ timeout: T.dialog }).catch(() => false);

    if (canConfirm) {
      // Step 35 — Click "Confirm" (accept)
      // EVENT: session/accept-clicked/v1 {sessionId: "..."}
      await confirmAccept.click();

      // Step 36 — Session accepted (status → accepted)
      // EVENT: session/status-changed/v1 {from: "accepting", to: "accepted"}
      // The action panel disappears once status === "accepted" (gated by
      // status !== "accepted" && status !== "rejected"), and a green
      // "Deployed to production" / "Merged into ..." banner appears.
      await expect(page.locator('[data-id="session/tab-accept"]')).toBeHidden({ timeout: T.deploy });
    } else {
      console.log(
        "[test] confirm-accept button not present — dev server is not on the session's parent branch. " +
          "This is expected when running tests from a worktree that isn't main. Skipping deploy step."
      );
    }
  });

  // -------------------------------------------------------------------------
  // Alternative: Reject flow (Acts 1-3 assumed complete; run against a ready session)
  // -------------------------------------------------------------------------

  test("reject flow (standalone — requires a ready session URL)", async ({ page }) => {
    const sessionUrl = process.env.PLAYWRIGHT_SESSION_URL;
    test.skip(!sessionUrl, "Set PLAYWRIGHT_SESSION_URL to run this test");

    await page.goto(sessionUrl!);
    await expect(page.locator('[data-id="session/tab-reject"]')).toBeVisible({ timeout: T.previewReady });

    // Step 34b — Click "Reject Changes" tab
    // EVENT: session/action-panel-toggled/v1 {action: "reject", open: true, sessionId: "..."}
    await page.click('[data-id="session/tab-reject"]');

    // Step 35b — Click "Confirm" (reject)
    // EVENT: session/reject-clicked/v1 {sessionId: "..."}
    await page.click('[data-id="session/confirm-reject"]');

    await expect(
      page.locator('text="rejected", [data-status="rejected"]')
    ).toBeVisible({ timeout: T.deploy });
  });

  // -------------------------------------------------------------------------
  // Bonus: utility actions (run against a ready session)
  // -------------------------------------------------------------------------

  test("utility actions (standalone — requires a ready session URL)", async ({ page }) => {
    const sessionUrl = process.env.PLAYWRIGHT_SESSION_URL;
    test.skip(!sessionUrl, "Set PLAYWRIGHT_SESSION_URL to run this test");

    await page.goto(sessionUrl!);
    await expect(page.locator('[data-id="session/tab-followup"]')).toBeVisible({ timeout: T.previewReady });

    // Copy branch name
    // EVENT: session/branch-name-copied/v1 {branch: "..."}
    const copyBranchBtn = page.locator('[aria-label="Copy branch name"]');
    if (await copyBranchBtn.isVisible()) {
      await copyBranchBtn.click();
    }

    // Apply upstream updates button (may be hidden if branch is up to date)
    // EVENT: session/upstream-sync-clicked/v1 {sessionId: "..."}
    const upstreamSync = page.locator('[data-id="session/apply-upstream-updates"]');
    if (await upstreamSync.isVisible({ timeout: T.dialog }).catch(() => false)) {
      await upstreamSync.click();
    }

    // Abort running agent (only visible while status is running-claude)
    // EVENT: session/abort-clicked/v1 {sessionId: "..."}
    const abortBtn = page.locator('[data-id="session/abort"]');
    if (await abortBtn.isVisible({ timeout: T.dialog }).catch(() => false)) {
      await abortBtn.click();
      await expect(page.locator('[data-id="session/tab-accept"]')).toBeVisible({ timeout: T.claudeRun });
    }

    // Restart dev server
    // EVENT: session/restart-server-clicked/v1 {sessionId: "..."}
    const restartBtn = page.locator('[data-id="session/restart-preview"]');
    if (await restartBtn.isVisible({ timeout: T.dialog }).catch(() => false)) {
      await restartBtn.click();
    }
  });
});
