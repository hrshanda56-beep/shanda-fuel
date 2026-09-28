import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button, EmptyState, ErrorState, Field, IconButton, StatusBadge } from './primitives';

describe('Button primitive', () => {
  it('defaults to a non-submitting button', () => {
    const markup = renderToStaticMarkup(createElement(Button, null, 'Action'));

    expect(markup).toContain('type="button"');
  });

  it('preserves an explicitly submitted button', () => {
    const submitProps = { type: 'submit' } as ComponentProps<typeof Button>;
    const markup = renderToStaticMarkup(createElement(Button, submitProps, 'Save'));

    expect(markup).toContain('type="submit"');
  });
});

describe('Button variants', () => {
  it('maps size and block to classes without affecting the default size', () => {
    const md = renderToStaticMarkup(createElement(Button, null, 'Save'));
    const sm = renderToStaticMarkup(
      createElement(Button, { size: 'sm', block: true } as ComponentProps<typeof Button>, 'Save'),
    );

    expect(md).toContain('class="button button-primary"');
    expect(sm).toContain('button-sm');
    expect(sm).toContain('button-block');
  });

  it('disables and marks busy while loading', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { loading: true } as ComponentProps<typeof Button>, 'Saving'),
    );

    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
  });
});

describe('IconButton', () => {
  it('always carries an accessible name', () => {
    const markup = renderToStaticMarkup(
      createElement(IconButton, { icon: 'close', label: 'Dismiss' }),
    );

    expect(markup).toContain('aria-label="Dismiss"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-hidden="true"');
  });
});

describe('Field', () => {
  it('wires hint, error, and required state to the control', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Field,
        {
          id: 'qty',
          label: 'Quantity',
          hint: 'Litres',
          error: 'Required',
          required: true,
        } as ComponentProps<typeof Field>,
        createElement('input', { id: 'qty' }),
      ),
    );

    expect(markup).toContain('aria-describedby="qty-hint qty-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-required="true"');
    expect(markup).toContain('role="alert"');
  });
});

describe('state layouts', () => {
  it('keeps inline states compact and block states centred', () => {
    const inline = renderToStaticMarkup(
      createElement(EmptyState, { title: 'None', message: 'Nothing yet' }),
    );
    const block = renderToStaticMarkup(
      createElement(EmptyState, { title: 'None', message: 'Nothing yet', layout: 'block' }),
    );

    expect(inline).toContain('state state-empty');
    expect(block).toContain('state-block');
  });

  it('announces errors in both layouts', () => {
    for (const layout of ['inline', 'block'] as const) {
      const markup = renderToStaticMarkup(createElement(ErrorState, { message: 'Failed', layout }));
      expect(markup).toContain('role="alert"');
    }
  });
});

describe('StatusBadge', () => {
  it('always renders readable text with its tone', () => {
    const markup = renderToStaticMarkup(
      createElement(
        StatusBadge,
        { tone: 'warning' } as ComponentProps<typeof StatusBadge>,
        'Variance',
      ),
    );

    expect(markup).toContain('status status-warning');
    expect(markup).toContain('Variance');
  });
});
