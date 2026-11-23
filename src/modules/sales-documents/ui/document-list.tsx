'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/design-system/icons';
import { Pagination, pageOf, usePageState } from '@/design-system/pagination';
import { Button, Card, EmptyState, ErrorState, StatusBadge } from '@/design-system/primitives';
import { todayInBusinessTime } from '@/modules/expenses/ui/expense-format';
import { DOC_LABELS, formatAmount, friendlyDate } from '../format';
import type { SalesDocumentListRow } from '../queries';
import styles from './sales-documents.module.css';
import { isOverdue, statusView } from './status';
import { useSalesCommand } from './use-sales-command';
import { formatMoney } from '@/design-system/formatters';

type Filter = 'ALL' | 'QUOTATION' | 'INVOICE' | 'RECEIPT';
type Show = 'ANY' | 'OPEN' | 'OVERDUE' | 'PAID' | 'DRAFT';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'QUOTATION', label: 'Quotations' },
  { key: 'INVOICE', label: 'Invoices' },
  { key: 'RECEIPT', label: 'Receipts' },
];

const SHOWS: { key: Show; label: string }[] = [
  { key: 'ANY', label: 'Any status' },
  { key: 'OPEN', label: 'Waiting for payment' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'PAID', label: 'Paid' },
  { key: 'DRAFT', label: 'Drafts' },
];

export function DocumentList({
  rows,
  today,
  tenantId,
  legalEntityId,
  canConvert,
  onOpen,
}: {
  rows: SalesDocumentListRow[];
  /** The business date, from the server, so "overdue" never depends on this browser's clock. */
  today: string;
  tenantId: string;
  legalEntityId: string;
  canConvert: boolean;
  onOpen: (documentId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [show, setShow] = useState<Show>('ANY');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftShow, setDraftShow] = useState<Show>('ANY');
  const filtersRef = useRef<HTMLDivElement>(null);
  const pageState = usePageState(`${filter}|${show}|${query}`);
  const command = useSalesCommand(tenantId);

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [filtersOpen]);

  // Search and status narrow the list first; the type chips then count what is left.
  const base = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (show === 'DRAFT' && row.status !== 'DRAFT') return false;
      if (show === 'OVERDUE' && !isOverdue(row, today)) return false;
      if (show === 'PAID' && row.paymentState !== 'PAID') return false;
      if (show === 'OPEN' && !(row.paymentState === 'UNPAID' || row.paymentState === 'PART_PAID')) {
        return false;
      }
      if (!needle) return true;
      return (
        row.recipientName.toLowerCase().includes(needle) ||
        (row.docNumber ?? '').toLowerCase().includes(needle)
      );
    });
  }, [rows, show, query, today]);

  const shown = useMemo(
    () => (filter === 'ALL' ? base : base.filter((row) => row.docType === filter)),
    [base, filter],
  );
  const page = pageOf(shown, pageState);
  const activeFilters = show !== 'ANY' ? 1 : 0;

  function toggleFilters() {
    if (!filtersOpen) setDraftShow(show);
    setFiltersOpen((open) => !open);
  }

  function makeInvoice(row: SalesDocumentListRow) {
    void command.send(
      {
        commandType: 'ConvertQuotationToInvoice',
        tenantId,
        legalEntityId,
        quotationId: row.id,
        issueDate: todayInBusinessTime(),
      },
      (result) => onOpen(String(result.documentId)),
    );
  }

  return (
    <Card as="section" className="panel" aria-labelledby="sales-document-list-title">
      <div className="panel-heading">
        <h2 id="sales-document-list-title">All documents</h2>
      </div>

      {rows.length > 0 ? (
        <>
          <div className={styles.toolbar}>
            <label className="list-search">
              <Icon name="search" />
              <input
                type="search"
                aria-label="Search documents"
                placeholder="Search documents"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
            </label>
            <div className={styles.filterMenu} ref={filtersRef}>
              <Button
                variant="secondary"
                aria-expanded={filtersOpen}
                aria-controls="sales-document-filter-panel"
                onClick={toggleFilters}
              >
                Filters{activeFilters > 0 ? ` · ${activeFilters}` : ''}
              </Button>
              {filtersOpen ? (
                <div
                  className={styles.filterPanel}
                  id="sales-document-filter-panel"
                  role="group"
                  aria-label="Filter documents"
                >
                  <label>
                    <span>Status</span>
                    <select
                      value={draftShow}
                      onChange={(event) => setDraftShow(event.target.value as Show)}
                    >
                      {SHOWS.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.filterActions}>
                    <Button variant="quiet" size="sm" onClick={() => setDraftShow('ANY')}>
                      Reset
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setShow(draftShow);
                        setFiltersOpen(false);
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <div
              className={`list-filters ${styles.chips}`}
              role="group"
              aria-label="Show document types"
            >
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="list-filter"
                  aria-pressed={filter === item.key}
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                  <span>
                    {item.key === 'ALL'
                      ? base.length
                      : base.filter((row) => row.docType === item.key).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {command.error ? <ErrorState title="Not done" message={command.error} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          layout="block"
          icon="receipt"
          title="Nothing here yet"
          message="Quotations, invoices and receipts you make will show up here."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          layout="block"
          icon="search"
          title="No documents match"
          message="Try a different search or filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setFilter('ALL');
                setShow('ANY');
                setQuery('');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <div className={styles.tableHead} aria-hidden="true">
            <span>Date</span>
            <span>Customer</span>
            <span className={styles.amount}>Amount</span>
            <span>Status</span>
            <span />
          </div>
          <ul className={styles.table} aria-label="Documents">
            {page.rows.map((row) => {
              const view = statusView(row, today);
              const convertible =
                canConvert &&
                row.docType === 'QUOTATION' &&
                !row.hasInvoice &&
                (row.status === 'ISSUED' || row.status === 'ACCEPTED');
              const detail = [
                `${DOC_LABELS[row.docType].one} ${row.docNumber ?? '(draft)'}`,
                row.balance && row.paymentState !== 'PAID'
                  ? `${formatMoney(row.balance, row.currency)} owed`
                  : '',
                isOverdue(row, today) && row.dueDate ? `was due ${friendlyDate(row.dueDate)}` : '',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={row.id} className={styles.item}>
                  <div className={styles.rowWrap}>
                    <button
                      type="button"
                      className={styles.tableRow}
                      onClick={() => onOpen(row.id)}
                    >
                      <span className={styles.cell}>{friendlyDate(row.issueDate)}</span>
                      <span className={`${styles.cell} ${styles.what}`}>
                        <strong>{row.recipientName}</strong>
                        <small>{detail}</small>
                      </span>
                      <span className={`${styles.cell} ${styles.amount}`}>
                        {formatMoney(row.total, row.currency)}
                      </span>
                      <span className={styles.cell}>
                        <StatusBadge tone={view.tone}>{view.text}</StatusBadge>
                      </span>
                      <span className={styles.chevron} aria-hidden="true">
                        <Icon name="chevron-right" />
                      </span>
                    </button>
                    {convertible ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className={styles.quick}
                        loading={command.busy}
                        onClick={() => makeInvoice(row)}
                      >
                        Make invoice
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination slice={page} label="Document pages" noun="documents" />
        </>
      )}
      {command.stepUp}
    </Card>
  );
}
