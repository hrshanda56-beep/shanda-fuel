// Re-baselines the UI lock. Run only when the owner has approved a change to an
// existing screen, and commit the manifest diff together with that change.
import { writeFileSync } from 'node:fs';
import { MANIFEST_PATH, hashOf, lockedFiles } from './files.mjs';

const files = Object.fromEntries(lockedFiles().map((p) => [p, hashOf(p)]));
writeFileSync(MANIFEST_PATH, `${JSON.stringify({ files }, null, 2)}\n`);
console.log(`ui-lock: ${Object.keys(files).length} files locked -> ${MANIFEST_PATH}`);
