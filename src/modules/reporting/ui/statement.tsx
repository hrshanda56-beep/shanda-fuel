import { formatBusinessDate } from '../../../design-system/formatters';
import { formatTileLitres, formatTileMoney } from '../format';
import { exact } from '../domain';
import type { ManagementReport } from '../contracts';
import type { Statement, StatementLine } from '../statements';

/** Accounting style: plain digits with thousands separators and brackets for negatives. */
export function formatStatementAmount(line: StatementLine): string {
  if (line.value === null) return 'Unavailable';
  if (line.unit === 'litres') return formatTileLitres(line.value);
  const full = formatTileMoney(line.value);
  if (full === '—') return full;
  const digits = full.replace(/^USD\s/, '');
  return exact(line.value).value.isNegative() && !/^-?0\.00$/.test(digits)
    ? `(${digits.replace('-', '')})`
    : digits.replace(/^-0\.00$/, '0.00');
}

/** Title block for a statement: what it is, the period covered and the stations included. */
export function StatementHeader({ title, report }: { title: string; report: ManagementReport }) {
  const stations =
    report.filters.stationIds.length === 0
      ? 'All stations'
      : report.stations
          .filter((station) => report.filters.stationIds.includes(station.stationId))
          .map((station) => station.name)
          .join(', ');
  return (
    <header className="statement-header">
      <h2>{title}</h2>
      <p>
        {formatBusinessDate(report.filters.fromDate)} to {formatBusinessDate(report.filters.toDate)}
      </p>
      <p>{stations}</p>
      <p className="statement-basis">Management statement · Unaudited · Amounts in USD</p>
    </header>
  );
}

/** Lines and totals laid out like an accounting statement, with amounts in one right-aligned column. */
export function StatementTable({ title, statement }: { title: string; statement: Statement }) {
  return (
    <>
      <table className="statement">
        <caption className="visually-hidden">{title}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="statement-amount">
              Amount
            </th>
          </tr>
        </thead>
        {statement.groups.map((group, index) => (
          <tbody key={group.heading ?? index}>
            {group.heading ? (
              <tr className="statement-heading">
                <th scope="colgroup" colSpan={2}>
                  {group.heading}
                </th>
              </tr>
            ) : null}
            {group.lines.map((line) => (
              <tr key={line.label} className={`statement-line statement-${line.kind ?? 'item'}`}>
                <th scope="row">
                  {line.label}
                  {line.note ? <small>{line.note}</small> : null}
                </th>
                <td
                  className="statement-amount"
                  data-unavailable={line.value === null || undefined}
                >
                  {formatStatementAmount(line)}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      {statement.notes.length > 0 ? (
        <ul className="statement-notes">
          {statement.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
