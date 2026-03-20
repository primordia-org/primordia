# Show submitted request text on progress page

## What changed

After a user submits a request on the `/evolve` page, their original request text is now displayed in a card at the top of the progress tracking area.

## Why

Once the form is submitted and transitions to the progress view, the textarea disappears and the user had no way to see what they had typed. This was confusing — especially if the CI pipeline takes minutes to run and the user has forgotten the exact wording. The new "Your request" card gives them immediate confirmation of what was submitted and keeps it visible throughout the progress polling.

## How

- Added a `submittedRequest: string | null` state variable to `EvolveForm.tsx`.
- Set it from the trimmed input in `handleSubmit` (before clearing the textarea).
- Reset it in `handleReset` alongside the other state resets.
- Rendered a styled card labeled **"Your request"** between the description banner and the progress messages, visible only after submission.
