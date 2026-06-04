# Make picker use named data-component and data-id highlights

The element picker now targets named DOM references instead of arbitrary nested DOM nodes. It highlights the nearest `data-component` as the generic app component target and the nearest `data-id` as the more specific control/element target when available.

What changed:

- Removed React fiber/component tree walking from the picker code.
- Restored the green outline for the nearest `data-id` target.
- Kept the blue outline for the nearest `data-component` target.
- Added labels for both names when both are present.
- Included both `data-component` and `data-id` names/selectors in generated markdown attachments.
- Removed the now-unused `css-selector-generator` dependency.
- Kept existing `data-id` names as the specific picker target for controls that are already sufficiently named that way, without adding redundant `data-component` attributes.

Why:

Server-rendered components do not map reliably to client-side React fiber trees. `data-component` and `data-id` are both meaningful names for user communication: one gives the generic component context and the other gives the specific element/control context.
