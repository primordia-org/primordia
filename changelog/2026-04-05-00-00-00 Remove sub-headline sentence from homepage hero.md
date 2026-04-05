# Mobile homepage hero improvements

Three iterative changes to tighten the landing page hero on mobile:

1. **Removed second sub-headline sentence** — deleted "Chat with Claude, propose a change in plain English, and watch the code update live." The remaining text is: "A web application that rewrites itself on demand." With the logo image now displayed above the headline, the extra sentence made the hero feel crowded.

2. **Fixed hero vertical centering** — added symmetric `pt-20 pb-20` padding so the hero content is truly centred in the viewport. Previously, only `pt-20` was present (to clear the fixed navbar), leaving 80 px more visual space above the content than below.

3. **Removed navbar from landing page** — removed `<LandingNav>` entirely and dropped both `pt-20` and `pb-20` (they were only needed to compensate for the fixed nav). The footer still has all navigation links. Removing the navbar frees vertical space on mobile and keeps the full-screen hero completely unobstructed.
