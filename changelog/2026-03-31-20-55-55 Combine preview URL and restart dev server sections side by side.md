# Combine Preview URL and Restart Dev Server sections side by side

## What changed

In `components/EvolveSessionView.tsx`, the **Preview URL** block and the **Restart Dev Server** block were previously rendered as two separate stacked sections. They are now combined into a single flex container that renders them **side by side on wider screens** (`sm:` breakpoint and above) and **stacked vertically on narrow screens**.

Both cards use `flex-1` so they share available width equally when displayed in a row.

## Why

The two sections are both short (a link and a button respectively) and logically related — they both concern the live preview server. Showing them side by side makes better use of horizontal space and reduces unnecessary vertical scrolling on the session tracking page.
