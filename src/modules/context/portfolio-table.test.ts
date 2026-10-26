import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PortfolioOperationsTable, PortfolioStationRow } from './portfolio-table';
it('uses the shared table and readable status badges with station and record links', () => {
  const output = renderToStaticMarkup(
    createElement(
      PortfolioOperationsTable,
      { count: 1 },
      createElement(PortfolioStationRow, {
        name: 'Arcturus',
        entity: 'Triumph Energy',
        href: '/station',
        facts: [
          { label: 'Business date', value: '2026-10-18' },
          { label: 'Operations', value: 'NOT STARTED' },
          { label: 'Approval', value: 'NO REVISION' },
          { label: 'Shifts', value: '0' },
          { label: 'Reconciliation', value: 'SUBMITTED', href: '/record' },
        ],
      }),
    ),
  );
  expect(output).toContain('<table');
  expect(output).toContain('Not Started');
  expect(output).toContain('No submission');
  expect(output).not.toContain('NO_REVISION');
  expect(output).toContain('href="/record"');
  expect(output).toContain('Open Arcturus');
});
it('keeps loading and failure states within a valid table row', () => {
  const output = renderToStaticMarkup(
    createElement(PortfolioStationRow, {
      name: 'Alpha',
      entity: 'Entity',
      href: '/station',
      message: 'Station data unavailable',
    }),
  );
  expect(output).toContain('<tr>');
  expect(output).toContain('colSpan="4"');
  expect(output).toContain('Station data unavailable');
  expect(output).not.toContain('data-label="Operations"');
});

it('renders four populated station rows using the actual shared components', () => {
  const names = ['Arcturus', 'Bindura', 'Gazebo', 'Maruta'];
  const output = renderToStaticMarkup(
    createElement(
      PortfolioOperationsTable,
      { count: 4 },
      names.map((name, index) =>
        createElement(PortfolioStationRow, {
          key: name,
          name,
          entity: 'Triumph Energy',
          href: `/operations/daily?stationId=${index}`,
          facts: [
            { label: 'Business date', value: '2026-10-18' },
            {
              label: 'Operations',
              value: ['NOT STARTED', 'CLOSED', 'IN PROGRESS', 'OPEN'][index]!,
            },
            { label: 'Approval', value: index === 2 ? 'PENDING APPROVAL' : 'NO REVISION' },
            { label: 'Shifts', value: String(index) },
          ],
        }),
      ),
    ),
  );
  expect(output.match(/scope="row"/g)).toHaveLength(4);
  if (process.env.PORTFOLIO_VISUAL_FIXTURE === '1')
    writeFileSync(join(tmpdir(), 'shanda-portfolio-visual.html'), output);
});
