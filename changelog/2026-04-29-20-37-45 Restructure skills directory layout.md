# Skills Directory Restructuring

## What Changed
Reorganized the skills directory structure to follow the pi convention: each skill now lives in its own subdirectory (`{skill-name}/SKILL.md`) instead of having all skills as flat files in a single directory.

## Before
```
.claude/skills/
  caveman.md
  using-exe-dev.md
```

## After
```
.claude/skills/
  caveman/
    SKILL.md
  using-exe-dev/
    SKILL.md
```

## Why
The pi coding agent harness expects skills to be organized in subdirectories with a `SKILL.md` file in each. This structure allows for future expansion (each skill directory can contain supporting files, configuration, examples, etc.) and aligns with pi's documented conventions.
