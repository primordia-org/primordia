# Fix edit icon references in PRIMORDIA.md

## What changed

Updated three references in `PRIMORDIA.md` that incorrectly described the evolve entry point as an "Edit (pencil) icon button in the header":

- **What Is Primordia?** section — updated to describe the hamburger (☰) menu and the "Propose a change" option
- **File Map** comment for `ChatInterface.tsx` — updated from "Edit icon button links to /evolve" to "hamburger menu 'Propose a change' links to /evolve"
- **Current Features** table row for Evolve mode — updated from "Edit icon in chat header" to "accessible via 'Propose a change' in the hamburger menu"

## Why

The chat interface has not had a dedicated pencil/edit icon button for some time. Navigation to `/evolve` is done via the hamburger menu's "Propose a change" item. The stale references were misleading the AI chat assistant (which reads PRIMORDIA.md as part of its system prompt) into incorrectly telling users to look for a ✏️ icon in the header.
