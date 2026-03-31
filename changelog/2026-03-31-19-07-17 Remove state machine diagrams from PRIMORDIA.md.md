# Remove state machine diagrams from PRIMORDIA.md

## What changed

Deleted the two Mermaid `stateDiagram-v2` blocks from the **Evolve Session State Machine** section of `PRIMORDIA.md`:

1. The first diagram listing the individual `LocalSessionStatus` and `DevServerStatus` enum values as state boxes.
2. The second diagram showing all valid combined states and the transitions between them.

The surrounding prose — the introductory description, the status reference tables, and the transition-trigger table — was left intact.

## Why

The diagrams were not adding useful information beyond what the reference tables already communicate clearly. Mermaid diagrams aren't rendered in many contexts where `PRIMORDIA.md` is read (e.g. raw text in an AI context window), so they added noise without benefit. Removing them makes the section shorter and easier to scan.
