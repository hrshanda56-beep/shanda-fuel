import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { breakpoints, mediaQueryUp } from './tokens';

const css = readFileSync(fileURLToPath(new URL('./styles/tokens.css', import.meta.url)), 'utf8');

const systemDarkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const explicitDarkStart = css.lastIndexOf(":root[data-theme='dark'] {");
const lightBlock = css.slice(css.indexOf(':root {'), systemDarkStart);
const systemDarkBlock = css.slice(systemDarkStart, explicitDarkStart);
const explicitDarkBlock = css.slice(explicitDarkStart);

type Tokens = Record<string, string>;
type Rgb = [number, number, number];

function parseTokens(block: string): Tokens {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
}

const light = parseTokens(lightBlock);
const dark = { ...light, ...parseTokens(explicitDarkBlock) };

function hexToRgb(value: string): Rgb {
  const hex = value.replace('#', '');
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)) as Rgb;
}

/** Resolves var() chains; translucent rgb() values are composited over `base`. */
function resolve(tokens: Tokens, name: string, base?: Rgb): Rgb {
  let value = tokens[name];
  while (value?.startsWith('var(')) value = tokens[value.slice(4, -1)];
  if (!value) throw new Error(`Unresolved token ${name}`);
  if (value.startsWith('#')) return hexToRgb(value);
  const rgba = value.match(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)%\)/);
  if (rgba && base) {
    const alpha = Number(rgba[4]) / 100;
    return [1, 2, 3].map((index, channel) =>
      Math.round(Number(rgba[index]) * alpha + base[channel]! * (1 - alpha)),
    ) as Rgb;
  }
  throw new Error(`Cannot resolve ${name}: ${value}`);
}

function luminance([r, g, b]: Rgb) {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

function contrast(a: Rgb, b: Rgb) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

// [foreground, background, WCAG 2.2 AA minimum]
const requiredPairs: [string, string, number][] = [
  ['--text-primary', '--bg-surface', 4.5],
  ['--text-primary', '--bg-canvas', 4.5],
  ['--text-secondary', '--bg-surface', 4.5],
  ['--text-secondary', '--bg-canvas', 4.5],
  ['--text-secondary', '--bg-subtle', 4.5],
  ['--text-tertiary', '--bg-surface', 4.5],
  ['--text-tertiary', '--bg-canvas', 4.5],
  ['--text-placeholder', '--bg-surface', 4.5],
  ['--text-link', '--bg-surface', 4.5],
  ['--text-link', '--bg-canvas', 4.5],
  ['--accent-text', '--accent-subtle', 4.5],
  ['--text-on-accent', '--accent', 4.5],
  ['--text-on-accent', '--accent-hover', 4.5],
  ['--tone-positive-text', '--tone-positive-bg', 4.5],
  ['--tone-warning-text', '--tone-warning-bg', 4.5],
  ['--tone-critical-text', '--tone-critical-bg', 4.5],
  ['--tone-info-text', '--tone-info-bg', 4.5],
  ['--tone-offline-text', '--tone-offline-bg', 4.5],
  ['--tone-neutral-text', '--tone-neutral-bg', 4.5],
  ['--text-secondary', '--tone-critical-bg', 4.5],
  ['--text-secondary', '--tone-warning-bg', 4.5],
  ['--text-secondary', '--tone-info-bg', 4.5],
  // Non-text contrast (WCAG 1.4.11): focus indicator, control boundaries, icons.
  ['--focus-ring', '--bg-surface', 3],
  ['--focus-ring', '--bg-canvas', 3],
  ['--border-control', '--bg-surface', 3],
  ['--accent', '--bg-surface', 3],
  ['--tone-critical-fg', '--bg-surface', 3],
  ['--tone-warning-fg', '--bg-surface', 3],
  ['--tone-positive-fg', '--bg-surface', 3],
];

describe('design tokens', () => {
  it('declares identical values for system dark and explicit dark themes', () => {
    expect(parseTokens(systemDarkBlock)).toEqual(parseTokens(explicitDarkBlock));
  });

  it('overrides only tokens that exist in the light theme', () => {
    const unknown = Object.keys(parseTokens(explicitDarkBlock)).filter((name) => !(name in light));
    expect(unknown).toEqual([]);
  });

  for (const [theme, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it.each(requiredPairs)(`${theme}: %s on %s meets %s:1`, (foreground, background, minimum) => {
      const surface = resolve(tokens, '--bg-surface');
      const bg = resolve(tokens, background, surface);
      expect(contrast(resolve(tokens, foreground, bg), bg)).toBeGreaterThanOrEqual(minimum);
    });
  }

  it('keeps danger button text readable in both themes', () => {
    expect(contrast([255, 255, 255], resolve(light, '--tone-critical-fg'))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(hexToRgb('#131312'), resolve(dark, '--tone-critical-fg')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('exposes mobile-first breakpoint queries matching the CSS', () => {
    expect(mediaQueryUp('md')).toBe('(min-width: 48rem)');
    expect(mediaQueryUp('lg')).toBe(`(min-width: ${breakpoints.lg}rem)`);
  });
});
