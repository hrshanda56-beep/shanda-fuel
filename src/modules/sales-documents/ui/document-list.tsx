'use client';

import { useState } from 'react';
import { Card, EmptyState, StatusBadge } from '@/design-system/primitives';
import { DOC_LABELS, formatAmount, friendlyDate } from '../format';
import type { SalesDocumentListRow } from '../queries';
import styles from './sales-documents.module.css';
import { statusView } from './status';

type Filter = 'ALL' | 'QUOTATION' | 'INVOICE' | 'RECEIPT';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'QUOTATION', label: 'Quotations' },
  { key: 'INVOICE', label: 'Invoices' },
  { key: 'RECEIPT', label: 'Receipts' },
];

export function DocumentList({
  rows,
  onOpen,
}: {
  rows: SalesDocumentListRow[];
  onOpen: (documentId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const shown = filter === 'ALL' ? rows : rows.filter((row) => row.docType === filter);

  return (
    <div className={styles.page}>
      <div className={styles.tabs} role="group" aria-label="Show">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.tab} ${filter === item.key ? styles.tabActive : ''}`}
            aria-pressed={filter === item.key}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Card className={styles.listCard}>
        {shown.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            message="Quotations, invoices and receipts you make will show up here."
          />
        ) : (
          <ul className={styles.list}>
            {shown.map((row) => {
              const view = statusView(row);
              return (
                <li key={row.id}>
                  <button type="button" className={styles.row} onClick={() => onOpen(row.id)}>
                    <span className={styles.rowTitle}>{row.recipientName}</span>
                    <span className={styles.rowSide}>
                      <span className={styles.rowAmount}>
                        {row.currency} {formatAmount(row.total)}
                      </span>
                    </span>
                    <span className={styles.rowMeta}>
                      {DOC_LABELS[row.docType].one} {row.docNumber ?? '(draft)'} ·{' '}
                      {friendlyDate(row.issueDate)}
                      {row.balance && row.paymentState !== 'PAID'
                        ? ` · ${row.currency} ${formatAmount(row.balance)} owed`
                        : ''}
                    </span>
                    <span className={styles.rowSide}>
                      <StatusBadge tone={view.tone}>{view.text}</StatusBadge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
