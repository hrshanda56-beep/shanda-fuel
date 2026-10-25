import Link from 'next/link';
import { buildContextHref, type ContextSelection } from '@/modules/context';
import { Card, EmptyState, StatusBadge } from '@/design-system/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import { DUE_BUCKET_LABELS, type DueBucket, type DueScheduleRow } from '../due-schedule';
import styles from './supplier-due.module.css';

export type SupplierDueData = {
  asOf: string;
  total: string;
  groups: ReadonlyArray<{
    bucket: DueBucket;
    label: string;
    total: string;
    count: number;
    rows: readonly DueScheduleRow[];
  }>;
};

const SUMMARY_BUCKETS: readonly DueBucket[] = [
  'OVERDUE',
  'WITHIN_7',
  'DAYS_8_TO_14',
  'DAYS_15_TO_30',
];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "12 Nov 2026" from a calendar date, without involving any time zone. */
function readableDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${day} ${months[(month ?? 1) - 1]} ${year}`;
}

function dueWording(row: DueScheduleRow): { text: string; tone: 'warning' | undefined } {
  if (row.daysUntilDue === null) return { text: 'No due date', tone: undefined };
  if (row.daysUntilDue < 0) {
    return { text: `${plural(-row.daysUntilDue, 'day', 'days')} late`, tone: 'warning' };
  }
  if (row.daysUntilDue === 0) return { text: 'Due today', tone: 'warning' };
  return { text: `In ${plural(row.daysUntilDue, 'day', 'days')}`, tone: undefined };
}

function terms(row: DueScheduleRow): string {
  if (row.paymentTerms === 'CREDIT' && row.creditPeriodDays !== null) {
    return `Credit, ${plural(row.creditPeriodDays, 'day', 'days')}`;
  }
  return row.paymentTerms === 'CREDIT' ? 'Credit' : 'Terms not recorded';
}

/**
 * What is owed to suppliers and when it falls due: overdue, the next 7 days, 8 to 14 days and
 * 15 to 30 days. Read-only. Amounts arrive as exact text and are only formatted for display.
 */
export function SupplierDueView({
  data,
  selection,
  search,
}: {
  data: SupplierDueData;
  selection: ContextSelection;
  search: string;
}) {
  const groups = new Map(data.groups.map((group) => [group.bucket, group]));
  const listed = data.groups.filter((group) => group.count > 0);

  return (
    <div className={styles.stack}>
      <p className={styles.intro}>
        What you owe suppliers, grouped by when payment is due. Figures are as at{' '}
        {readableDate(data.asOf)} and only count what is still unpaid. Cash purchases are not listed
        because they are paid when bought.
      </p>

      <div className={styles.summary} role="list" aria-label="Amounts due">
        {SUMMARY_BUCKETS.map((bucket) => {
          const group = groups.get(bucket);
          const count = group?.count ?? 0;
          return (
            <Card
              key={bucket}
              as="div"
              role="listitem"
              className={styles.summaryCard}
              data-tone={bucket === 'OVERDUE' && count > 0 ? 'warning' : undefined}
            >
              <p className={styles.summaryLabel}>{DUE_BUCKET_LABELS[bucket]}</p>
              <p className={styles.summaryValue}>{formatTileMoney(group?.total ?? '0')}</p>
              <p className={styles.summaryNote}>
                {count === 0 ? 'Nothing' : plural(count, 'invoice', 'invoices')}
              </p>
            </Card>
          );
        })}
      </div>

      {listed.length === 0 ? (
        <EmptyState
          layout="block"
          icon="check"
          title="Nothing is waiting to be paid"
          message="There are no unpaid supplier invoices. New credit purchases will appear here once they are posted."
        />
      ) : (
        listed.map((group) => (
          <Card key={group.bucket} as="section" className="panel" aria-label={group.label}>
            <div className={styles.groupHead}>
              <h3 className={styles.groupTitle}>{group.label}</h3>
              <span className={styles.groupTotal}>{formatTileMoney(group.total)}</span>
            </div>
            <div className={`list-table ${styles.dueTable}`}>
              <div className="list-head" aria-hidden="true">
                <span>Supplier</span>
                <span>Invoice</span>
                <span>Due</span>
                <span>Still to pay</span>
              </div>
              <ul className="list-rows" aria-label={group.label}>
                {group.rows.map((row) => {
                  const href = buildContextHref(
                    `/suppliers/${encodeURIComponent(row.supplierId)}`,
                    search,
                    selection,
                  );
                  const due = dueWording(row);
                  return (
                    <li key={row.documentId} className="list-item">
                      <Link className="list-row" href={href}>
                        <span className="list-name">
                          <span>
                            <strong>{row.supplierName}</strong>
                            <small>{terms(row)}</small>
                          </span>
                        </span>
                        <span className="list-cell" data-label="Invoice">
                          {row.referenceNumber}
                        </span>
                        <span className="list-cell" data-label="Due">
                          {row.dueDate ? readableDate(row.dueDate) : '—'}
                          <StatusBadge tone={due.tone === 'warning' ? 'warning' : 'neutral'} plain>
                            {due.text}
                          </StatusBadge>
                        </span>
                        <span className="list-cell list-amount" data-label="Still to pay">
                          {formatTileMoney(row.balance)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
