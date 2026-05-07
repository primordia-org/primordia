# Append skill directives to end of prompt instead of prepending

## What changed

`EvolveRequestForm.tsx` now appends the caveman skill directive to the **end** of the user's request text instead of prepending it:

```
// Before
/caveman ultra

User's actual request text

// After
User's actual request text

/caveman ultra
```

The `stripSkillDirective` helper and `SKILL_PREFIXES` constant in `app/api/evolve/route.ts` have been removed — they are no longer needed.

## Why

When the directive was prepended, the Bell notification menu would show `/caveman ultra…` as the preview text for every skill-enhanced session instead of the actual request. Branch slug generation also had to strip the directive manually to avoid names like `caveman-full-add-dark-mode`. Appending the directive fixes both problems at once: the slug generator and notification preview both see the real request text at the start, and Claude still receives the skill instruction at the end of the prompt where it works just as well.
