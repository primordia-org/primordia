# Remove extra space above Files changed section

## What changed

Moved the `messagesEndRef` sentinel div out of the `gap-6` flex container that holds the progress sections. Previously it was the last child inside that container, which caused the `gap-6` spacing (24 px) to appear between the last visible section (e.g. Preview server) and the empty sentinel div — creating a visible blank gap above the "Files changed" accordion.

## Why

The sentinel div only exists for auto-scrolling purposes; it carries no visual content. Placing it inside a `flex-col gap-6` container made it act as a flex item and consume a full gap slot. Moving it immediately after the container's closing tag eliminates that phantom space without affecting scroll behaviour.
