import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './primitives';

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
