# Shorten preview page hint in evolve agent instructions

Changed the wording of the instruction given to the evolve agent when asking it to mention the relevant preview page at the end of its response.

**Before:** `"The relevant page is at \`/path\`."`
**After:** `"Preview \`/path\`."`

The old phrasing read awkwardly when reproduced verbatim in the session output. The new form is shorter and more natural.

Files changed: `lib/evolve-sessions.ts` (two occurrences — one in the initial-request instruction block, one in the follow-up instruction block).
