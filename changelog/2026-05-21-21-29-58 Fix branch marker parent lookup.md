# Fix branch marker parent lookup

Branch-marker parent detection now reads marker commits only from the branch's first-parent history. This prevents marker commits from merged child branches from being mistaken for the branch's own marker, which could make a parented branch such as `gemini-35-flash-support` appear unattached after child sessions were merged into it.

Added a regression test that creates a production branch, a session branch, a child session branch, merges the child back into the parent branch, and verifies the parent branch still resolves to production.
