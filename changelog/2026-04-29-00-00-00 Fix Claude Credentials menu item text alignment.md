# Fix Claude Credentials menu item text alignment

## What changed
Added `text-left` to the "Claude Credentials" button in `HamburgerMenu.tsx`.

## Why
The button's label wraps to two lines on narrower menus. HTML `<button>` elements default to `text-align: center`, so the wrapped text appeared centered — inconsistent with the other left-aligned menu items. Adding `text-left` keeps it aligned with the rest of the nav items.
