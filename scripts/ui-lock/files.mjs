// Shared by the manifest generator and the guard test.
// A file is "locked" when it defines the look or behaviour of an existing screen.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const UI_DIR = /^src\/modules\/[^/]+\/ui\//;
const DESIGN_SYSTEM = /^src\/design-system\//;
const APP_UI = /^src\/app\/.*(page|layout|loading|error|not-found)\.tsx$|^src\/app\/.*\.css$/;
// Synthetic harnesses are not product screens.
const EXCLUDED = /^src\/app\/(dev-preview|owner-demo)\//;
const TEST_FILE = /\.(test|spec)\.[tj]sx?$/;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full).split(sep).join('/'));
  }
}

export function lockedFiles() {
  const all = [];
  walk(join(ROOT, 'src'), all);
  return all
    .filter((p) => !TEST_FILE.test(p) && !EXCLUDED.test(p))
    .filter((p) => UI_DIR.test(p) || DESIGN_SYSTEM.test(p) || APP_UI.test(p))
    .sort();
}

export function hashOf(path) {
  const text = readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex');
}

export const MANIFEST_PATH = 'docs/ui-lock/manifest.json';
