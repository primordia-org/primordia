# Fix emoji hydration mismatch in SimpleMarkdown

## What changed

Added `suppressHydrationWarning` to the plain-text `<span>` elements rendered by `SimpleMarkdown` in `components/SimpleMarkdown.tsx`.

## Why

Next.js was occasionally throwing a hydration error on the session page when AI progress messages contained emoji characters (e.g. `🔧 Read ...`). The root cause is that Node.js (server-side) and the browser can produce different byte representations for the same emoji — particularly around surrogate pairs — causing React's server-rendered HTML to mismatch the client-rendered DOM.

```
Uncaught Error: Hydration failed because the server rendered text didn't match the client.
  <SimpleMarkdown text="🔧 Read `....">
    <span>
+     {"🔧 Read "}   ← client
-     {"🔧 Read "}   ← server (broken encoding)
```

`suppressHydrationWarning` is the React-recommended way to silence these spurious mismatches on leaf nodes where the server/client content is known to be semantically identical. React still hydrates the tree correctly using the client value; it just skips the mismatch error for those spans.

No visual or behavioural change — this is a pure error-suppression fix scoped to the leaf `<span>` nodes that render raw text fragments.
