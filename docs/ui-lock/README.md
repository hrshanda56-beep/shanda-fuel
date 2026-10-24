# UI lock

The screens that exist today are locked by owner instruction (2026-10-22). Their
look and behaviour must not change.

- `manifest.json` holds a SHA-256 for every locked file: each `page`, `layout`,
  `loading`, `error` and CSS file under `src/app`, everything under
  `src/modules/*/ui`, and everything under `src/design-system` (tests excluded;
  `dev-preview` and `owner-demo` are synthetic harnesses and not locked).
- `src/platform/ui-lock/ui-lock.test.ts` fails if a locked file is edited or deleted.
- New screens are welcome. Add them with `node scripts/ui-lock/update-manifest.mjs`
  once they are finished, so they are locked from then on.
- Changing an existing screen needs explicit owner approval. Re-baseline in the same
  commit and say why in the commit message.
