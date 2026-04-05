# Remove sub-headline sentence from homepage hero

Deleted the second sentence from the hero sub-headline on the landing page:

> "Chat with Claude, propose a change in plain English, and watch the code update live."

The remaining text is: "A web application that rewrites itself on demand."

**Why:** With the logo image now displayed above the headline, the hero section felt crowded on mobile. Trimming the extra sentence tightens the layout and keeps the hero concise.

## Fix hero vertical centering on mobile

Added `pb-20` to the hero section to balance the existing `pt-20` (used to clear the fixed nav bar).

**Why:** `justify-center` distributes free flex space equally above and below the content, but the 80 px top padding was counted as part of the section without a matching bottom counterpart — leaving 80 px more visual space above the content than below and making the hero appear shifted downward. Adding `pb-20` makes the padding symmetric so the content is truly centred in the viewport.
