# Paginate changelog page to 100 entries per page

## What changed

The `/changelog` page now shows at most 100 entries at a time instead of the full list. A pagination bar appears at the bottom of the page when there are more than 100 entries, with:

- **← Newer** / **Older →** navigation links (greyed out when at the first or last page)
- A centre label showing the range of entries currently displayed (e.g. "1–100 of 243")
- The page header counter also gains a `(page N of M)` suffix when pagination is active

Navigation is done via a plain `?page=N` query-string parameter so the page remains a pure server component with no client-side state. Out-of-range page numbers are clamped to the nearest valid page.

## Why

As the changelog grows, rendering hundreds of `<details>` elements in a single server response adds unnecessary weight. Limiting to 100 entries per page keeps the initial render fast while keeping the full history accessible.
