# Preview sidebar layout on desktop

## What changed

On desktop (xl breakpoint and above), the Web Preview panel for an evolve session is now displayed as a full-screen-height sticky sidebar on the right side of the page, instead of inline within the scrollable content area.

- The session content (request, progress sections, actions) shifts to the left column (~560 px wide) when a preview is available.
- The preview fills the remaining horizontal space as a `sticky top-0 h-dvh` aside panel, so it stays in view while the user scrolls the main content.
- On mobile (below xl) the preview remains inline as before.
- `WebPreviewPanel` gained two new optional props: `fullHeight` (makes the iframe fill the container vertically with `flex-1` instead of a fixed 600 px height) and `className` (forwarded to the outer wrapper).
- The sidebar has `p-4` padding so the panel retains its rounded corners and emerald border, matching the look it has when rendered inline on smaller screens.
- While the preview server is starting or its status is still being checked, the sidebar shows a matching placeholder instead of the panel.

## Why

The previous layout required users to scroll past the large inline iframe to reach the accept/reject/follow-up actions. With the sidebar layout, the preview and the action controls are simultaneously visible on any reasonably wide screen, which makes reviewing and iterating on changes much faster.
