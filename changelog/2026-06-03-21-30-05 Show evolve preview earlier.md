# Show evolve preview earlier

The evolve session page now makes the web preview available as soon as an agent records an explicit preview path with `bun run set-preview-url`, instead of waiting for the agent run to reach the ready state. The preview server status and logs also start updating once that preview URL exists.

On mobile layouts, the inline web preview has moved below the Available Actions section so follow-up, accept, and reject controls remain easier to reach before the preview card.

Agent instructions now ask coders to set the preview route immediately after editing app files and before validation/typecheck/build work or changelog edits, giving users earlier access to the relevant page while the rest of the pipeline continues.
