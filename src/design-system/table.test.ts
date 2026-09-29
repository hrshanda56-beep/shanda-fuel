import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TableScrollRegion } from './table';

describe('TableScrollRegion', () => {
  it('server-renders a named, keyboard-focusable region around the table', () => {
    const markup = renderToStaticMarkup(
      createElement(TableScrollRegion, { label: 'Station sales' }, createElement('table')),
    );

    expect(markup).toBe(
      '<div class="responsive-table-wrap" role="region" aria-label="Station sales" tabindex="0"><table></table></div>',
    );
  });
});
