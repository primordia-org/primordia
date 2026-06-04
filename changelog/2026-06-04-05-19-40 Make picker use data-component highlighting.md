# Make picker use data-component highlighting

The element picker now only targets the nearest DOM element annotated with `data-component`. This keeps highlighted and captured references tied to named app components instead of arbitrary nested DOM nodes.

What changed:

- Removed React fiber/component tree walking from the picker code.
- Removed the green hovered-element highlight and secondary selector label.
- Kept a single blue highlight around the selected `data-component` element.
- Changed generated selectors to use only `data-component` attributes.
- Removed the now-unused `css-selector-generator` dependency.

Why:

Server-rendered components do not map reliably to client-side React fiber trees. Requiring `data-component` annotations makes the picker enforce named, talkable UI targets and avoids brittle element-level selectors.
