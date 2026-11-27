import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WizardOptions, WizardRowAction } from './wizard-kit';

const html = (options: Parameters<typeof WizardOptions<string>>[0]['options']) =>
  renderToStaticMarkup(
    createElement(WizardOptions<string>, {
      label: 'Pump',
      name: 'pump',
      options,
      value: 'a',
      onPick: () => {},
    }),
  );

describe('big answers with buttons on the right', () => {
  it('draws a row without actions exactly as before: one label, no extra wrapper', () => {
    const out = html([{ value: 'a', label: 'Pump 1', detail: '3 nozzles now' }]);
    expect(out).toContain('<label class="');
    expect(out).toContain('Pump 1');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('<div class="wizard_choice');
    // The whole row is the label, so the whole row picks.
    expect(out.match(/<label/g)).toHaveLength(1);
  });

  it('puts the buttons beside the pick, never inside its label', () => {
    const out = html([
      {
        value: 'a',
        label: 'Pump 1',
        detail: '3 nozzles now',
        actions: createElement('button', { type: 'button' }, 'Edit'),
      },
      { value: 'b', label: 'Pump 3' },
    ]);
    const label = /<label[^>]*>([\s\S]*?)<\/label>/.exec(out)![1]!;
    expect(label).toContain('type="radio"');
    expect(label).toContain('Pump 1');
    expect(label).toContain('3 nozzles now');
    expect(label).not.toContain('<button');
    expect(out).toContain('>Edit</button>');
    // The second row had no actions, so it stays a plain label.
    expect(out.match(/<label/g)).toHaveLength(2);
    expect(out.match(/<button/g)).toHaveLength(1);
  });

  it('keeps one radio per row, grouped for assistive technology', () => {
    const out = html([
      { value: 'a', label: 'Pump 1', actions: createElement('button', null, 'Edit') },
      { value: 'b', label: 'Pump 3', actions: createElement('button', null, 'Edit') },
    ]);
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/type="radio"/g)).toHaveLength(2);
  });
});

describe('buttons for the right of a row', () => {
  const RowAction = WizardRowAction as ComponentType<{ danger?: boolean; children?: ReactNode }>;

  it('tints only the removing button red, and keeps both as plain small buttons', () => {
    const out = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(RowAction, null, 'Edit'),
        createElement(RowAction, { danger: true }, 'Delete'),
      ),
    );
    const [edit, remove] = out.match(/<button[^>]*>/g)!;
    expect(edit).toContain('type="button"');
    expect(remove).toContain('type="button"');
    expect(edit).not.toMatch(/rowDanger/);
    expect(remove).toMatch(/rowDanger/);
    expect(edit).toContain('button-secondary');
    expect(remove).toContain('button-secondary');
  });
});
