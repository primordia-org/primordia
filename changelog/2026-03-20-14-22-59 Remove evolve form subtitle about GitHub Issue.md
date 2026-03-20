# Remove evolve form subtitle about GitHub Issue

## What changed

- **Removed** the sentence "Your request will become a GitHub Issue and trigger an automated PR." from the production subtitle in `components/EvolveForm.tsx`.

## Why

The subtitle text was implementation-detail noise that didn't add value for users submitting requests. Removing it keeps the evolve form clean and focused on the user's action ("Describe a change you want to make to this app.") without exposing how the pipeline works internally.
