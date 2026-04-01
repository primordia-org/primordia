# Add intentional type error to test pre-merge type-checking gate

## What changed

Added a deliberate TypeScript type error in `lib/page-title.ts`:

```ts
const _typeCheckTest: number = "this is not a number";
```

This assigns a `string` literal to a variable declared as `number`, which TypeScript will reject.

## Why

This change exists solely to validate that the pre-merge type-checking gate correctly catches and blocks type errors before a branch can be accepted. Once the gate is confirmed to be working as expected, this change should be reverted.
