Filter open evolve issue search to only return issues related to the current request, and auto-create a new issue when none match.

**What changed**:
- `app/api/evolve/route.ts`: added `extractKeywords(request)` helper that strips punctuation, filters words ≤ 3 characters, and takes the first 6 keywords. `searchOpenEvolveIssues` now accepts a `request` parameter and appends those keywords to the GitHub search query, narrowing results to issues whose title/body/comments overlap with the user's request. The `search` action handler passes `body.request` through to the function.

**Why**: Previously, searching for open evolve issues returned every open `[Primordia Evolve]` issue, flooding the decision card with unrelated entries. With keyword-based filtering, only genuinely related issues are returned. When no related issues exist the frontend already falls through to auto-creating a new issue — so the decision prompt is now suppressed for truly new requests.
