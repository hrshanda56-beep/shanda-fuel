import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM helper shared with the manifest generator
import { MANIFEST_PATH, hashOf, lockedFiles } from '../../../scripts/ui-lock/files.mjs';

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
  files: Record<string, string>;
};

const HOW_TO_UNLOCK =
  'Existing screens are locked (see docs/ui-lock/README.md). If the owner approved this change, run `node scripts/ui-lock/update-manifest.mjs` and commit the manifest with it.';

describe('existing UI is locked', () => {
  it('has not changed or lost any locked file', () => {
    const changed = Object.entries(manifest.files)
      .filter(([path, hash]) => {
        try {
          return hashOf(path) !== hash;
        } catch {
          return true;
        }
      })
      .map(([path]) => path);
    expect(changed, HOW_TO_UNLOCK).toEqual([]);
  });

  it('does not let a new UI file slip in unrecorded', () => {
    // New screens are allowed, but they must be added to the manifest on purpose
    // so the lock always covers them from then on.
    const unrecorded = (lockedFiles() as string[]).filter((p) => !(p in manifest.files));
    expect(
      unrecorded,
      'New UI files must be recorded: node scripts/ui-lock/update-manifest.mjs',
    ).toEqual([]);
  });
});
