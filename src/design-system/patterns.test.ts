import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'styles', 'patterns.css'), 'utf8');
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('page patterns', () => {
  it('uses semantic tokens, never colour literals', () => {
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b(rgb|rgba|hsl|oklch)\(/);
  });

  it('never lets a flex or grid child shrink to one character', () => {
    expect(body).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('defines the shared page classes', () => {
    for (const name of ['pg', 'pg-intro', 'pg-stats', 'pg-card', 'pg-list', 'pg-form']) {
      expect(body).toContain(`.${name} {`);
    }
  });
});
