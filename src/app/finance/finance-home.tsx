import Link from 'next/link';
import { ColumnChart } from '@/design-system/column-chart';
import { formatBusinessDate } from '@/design-system/formatters';
import { InfoTip } from '@/design-system/info-tip';
import { NotchedCard } from '@/design-system/notched-card';
import { Card, EmptyState, ErrorState, StatusBadge } from '@/design-system/primitives';
import { TabbedCard } from '@/design-system/tabbed-card';
import type { ActionCenter, ActionCenterFacts, ActionItem } from '@/modules/approvals';
import { buildContextHref } from '@/modules/context/routes';
import type { CurrentContext } from '@/modules/context/contracts';
import { CashDonut, type DonutSlice } from '@/modules/cash/ui/cash-visuals';
import { ExactDecimal } from '@/platform/domain/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import styles from './finance-home.module.css';

type Row = { item: ActionItem; times: number };

/** The same reminder said twice is one row with a count, so a long list stays short. */
function collapse(items: readonly ActionItem[]): Row[] {
  const rows: Row[] = [];
  const seen = new Map<string, Row>();
  for (const item of items) {
    const key = `${item.area}|${item.tone}|${item.title}|${item.detail}|${item.href}`;
    const row = seen.get(key);
    if (row) row.times += 1;
    else {
      const fresh = { item, times: 1 };
      seen.set(key, fresh);
      rows.push(fresh);
    }
  }
  return rows;
}

/** "2026-10-29" reads as "29 Oct 2026" wherever a date sits inside a sentence. */
const readable = (text: string) =>
  text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => formatBusinessDate(date));

const MONEY_CURRENCY = /^[A-Z]{3}(?=\s)/;
const currency = MONEY_CURRENCY.exec(formatTileMoney('0'))?.[0] ?? null;
const figure = (value: string) => formatTileMoney(value).replace(/^[A-Z]{3}\s/, '');
const unit = currency ? `Amount in ${currency}` : 'Amount';
const positive = (value: string) => Number(value) > 0;

type CashFacts = { collectedButUnbanked: string; pendingBankConfirmation: string };

const cashTotal = (cash: CashFacts) =>
  new ExactDecimal(cash.collectedButUnbanked).add(new ExactDecimal(cash.pendingBankConfirmation))
    .value;

/** The ring splits what is on its way to the bank; the legend carries the exact amounts. */
function cashSlices(cash: CashFacts): DonutSlice[] {
  const total = cashTotal(cash);
  const share = (value: string) =>
    total.gt(0) ? Math.round(new ExactDecimal(value).value.div(total).mul(100).toNumber()) : 0;
  return [
    {
      key: 'unbanked',
      label: 'Collected, not yet deposited',
      total: cash.collectedButUnbanked,
      count: 0,
      detail: `${share(cash.collectedButUnbanked)}% of cash to bank`,
      tone: 0,
    },
    {
      key: 'pending',
      label: 'Awaiting the bank',
      total: cash.pendingBankConfirmation,
      count: 0,
      detail: `${share(cash.pendingBankConfirmation)}% of cash to bank`,
      tone: 2,
    },
  ];
}

function Unavailable({ what }: { what: string }) {
  return (
    <div className={styles.unavailable}>
      <ErrorState
        title={`${what} could not be checked`}
        message="Reload the page to try again. Nothing has been changed."
      />
    </div>
  );
}

function TaskTable({
  rows,
  label,
  current,
}: {
  rows: readonly Row[];
  label: string;
  current: CurrentContext;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        layout="block"
        icon="check"
        title="Nothing waiting"
        message="There is nothing to do here right now."
      />
    );
  }
  return (
    <div className={`list-table ${styles.table}`}>
      <div className="list-head" aria-hidden="true">
        <span>Task</span>
        <span>Area</span>
        <span>Priority</span>
      </div>
      <ul className="list-rows" aria-label={label}>
        {rows.map(({ item, times }) => (
          <li key={item.id} className="list-item">
            <Link
              className="list-row"
              href={
                item.href.startsWith('/') && !item.href.includes('?')
                  ? buildContextHref(item.href, '', current)
                  : item.href
              }
            >
              <span className={`list-name ${styles.task}`}>
                <strong>
                  {readable(item.title)}
                  {times > 1 ? <span className={styles.times}>×{times}</span> : null}
                </strong>
                <small>{readable(item.detail)}</small>
              </span>
              <span className={`list-cell ${styles.area}`} data-label="Area">
                {item.area === 'Operations' ? 'Station' : item.area}
              </span>
              <span className="list-cell" data-label="Priority">
                <StatusBadge tone={item.tone === 'attention' ? 'warning' : 'informational'}>
                  {item.tone === 'attention' ? 'Needs action' : 'For information'}
                </StatusBadge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Finance home: what is owed and waiting in money, then the work that needs a finance person.
 * Every figure comes from the same checks as the list below it, and each row opens the screen
 * that resolves it.
 */
export function FinanceHome({
  center,
  facts,
  current,
}: {
  center: ActionCenter;
  facts: ActionCenterFacts;
  current: CurrentContext & { stationId: string };
}) {
  const station = `/stations/${encodeURIComponent(current.stationId)}`;
  const finance = collapse(center.items.filter((item) => item.area !== 'Operations'));
  const atStation = collapse(center.items.filter((item) => item.area === 'Operations'));
  const open = (rows: readonly Row[]) => rows.reduce((sum, row) => sum + row.times, 0);

  const cash = facts.cash.status === 'ok' ? facts.cash.value : null;
  const suppliers = facts.suppliers.status === 'ok' ? facts.suppliers.value : null;
  const showCash = facts.cash.status !== 'restricted';
  const showSuppliers = facts.suppliers.status !== 'restricted';
  const hasCharts = showCash || showSuppliers;

  return (
    <div className={`finance-home ${styles.page}`}>
      <div className={styles.stack}>
        {center.unavailable.length > 0 ? (
          <ErrorState
            title="Some items could not be checked"
            message={`${center.unavailable.join(', ')} could not be loaded. Reload to try again. Anything listed below is still correct.`}
          />
        ) : null}

        {hasCharts ? (
          <div className={styles.split}>
            {showCash ? (
              <NotchedCard
                title="Cash to bank"
                titleId="finance-cash-title"
                titleAside={
                  <InfoTip>
                    Cash collected at the station that has not reached the bank yet, and deposits
                    that are recorded but not yet confirmed against the bank record.
                  </InfoTip>
                }
                className={styles.chartCard}
                notchWidth={9.5}
                actions={
                  <Link
                    className="button button-secondary"
                    href={buildContextHref(`${station}/cash`, '', current)}
                  >
                    Cash &amp; Banking
                  </Link>
                }
              >
                {cash ? (
                  <div className={`profit-split ${styles.donutBody}`}>
                    <CashDonut
                      slices={cashSlices(cash)}
                      currency={currency ?? ''}
                      centreLabel="To bank"
                      centreValue={formatTileMoney(cashTotal(cash).toFixed(2))}
                      selectOpensDialog={false}
                    />
                  </div>
                ) : (
                  <Unavailable what="Cash" />
                )}
              </NotchedCard>
            ) : null}
            {showSuppliers ? (
              <NotchedCard
                title="Owed to suppliers"
                titleId="finance-suppliers-title"
                titleAside={
                  <InfoTip>
                    What is still unpaid on supplier invoices, by how soon it has to be paid. Cash
                    purchases are left out because they are paid when bought.
                  </InfoTip>
                }
                className={styles.chartCard}
                notchWidth={9}
                actions={
                  <Link
                    className="button button-secondary"
                    href={buildContextHref('/suppliers/due', '', current)}
                  >
                    Payments Due
                  </Link>
                }
              >
                {suppliers ? (
                  <ColumnChart
                    label="Owed to suppliers"
                    unit={unit}
                    rows={[
                      {
                        id: 'overdue',
                        label: 'Overdue',
                        value: Number(suppliers.overdueTotal),
                        display: figure(suppliers.overdueTotal),
                        note:
                          suppliers.overdueSuppliers === 0
                            ? 'nothing overdue'
                            : `${suppliers.overdueSuppliers} ${suppliers.overdueSuppliers === 1 ? 'supplier' : 'suppliers'}`,
                        tone: positive(suppliers.overdueTotal) ? 'warning' : undefined,
                      },
                      {
                        id: 'today',
                        label: 'Due today',
                        value: Number(suppliers.dueTodayTotal),
                        display: figure(suppliers.dueTodayTotal),
                      },
                      {
                        id: 'soon',
                        label: `Due in ${suppliers.dueSoonDays} days`,
                        value: Number(suppliers.dueSoonTotal),
                        display: figure(suppliers.dueSoonTotal),
                      },
                    ]}
                  />
                ) : (
                  <Unavailable what="Supplier payments" />
                )}
              </NotchedCard>
            ) : null}
          </div>
        ) : null}

        {center.items.length > 0 ? (
          <TabbedCard
            title="Needs your attention"
            tabs={[
              {
                id: 'finance',
                label: `Finance work (${open(finance)})`,
                aside: (
                  <InfoTip>
                    Approvals, banking, settlements and supplier payments that need a finance
                    person, most urgent first. Open a row to go to the screen that sorts it out.
                  </InfoTip>
                ),
                content: <TaskTable rows={finance} label="Finance work" current={current} />,
              },
              {
                id: 'station',
                label: `At the station (${open(atStation)})`,
                aside: (
                  <InfoTip>
                    Reminders about the running of the station, such as missing dip readings and
                    cash differences. The station team deals with these; they are here so nothing is
                    missed.
                  </InfoTip>
                ),
                content: <TaskTable rows={atStation} label="Station reminders" current={current} />,
              },
            ]}
          />
        ) : center.unavailable.length === 0 ? (
          <Card as="section" className="panel profit-panel">
            <EmptyState
              layout="block"
              icon="check"
              title="All clear"
              message="Nothing is waiting for approval, banking or matching at this station."
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
