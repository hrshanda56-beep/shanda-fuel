'use client';

import { useState } from 'react';

import { ConfirmDialog, WorkInProgressDialog, WorkInProgressTrigger } from '../dialogs';
import { NeedsAttention, Notice, WipBadge, WorkInProgressPanel } from '../feedback';
import { Checkbox, Disclosure, Fieldset, Radio, Select } from '../forms';
import { MetricCard, PageContainer, PageHeader, Section } from '../layout';
import { Modal } from '../modal';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  LoadingState,
  NumericInput,
  Skeleton,
  SkeletonBlock,
  StatusBadge,
  type StatusTone,
} from '../primitives';
import { TableScrollRegion } from '../table';
import { useThemePreference } from '../theme-runtime';
import { isThemePreference } from '../theme';
import styles from './reference.module.css';

/*
 * Internal reference for the design-system foundation. All content is
 * synthetic and exists only to exercise the primitives in both themes and at
 * every breakpoint. Nothing here represents client master data.
 */

const colourGroups: { title: string; tokens: string[] }[] = [
  {
    title: 'Surfaces',
    tokens: ['--bg-canvas', '--bg-surface', '--bg-subtle', '--bg-muted', '--bg-selected'],
  },
  {
    title: 'Text',
    tokens: ['--text-primary', '--text-secondary', '--text-tertiary', '--text-disabled'],
  },
  { title: 'Borders', tokens: ['--border-subtle', '--border-default', '--border-strong'] },
  { title: 'Accent', tokens: ['--accent', '--accent-hover', '--accent-subtle', '--accent-text'] },
  {
    title: 'Semantic tones',
    tokens: [
      '--tone-positive-fg',
      '--tone-warning-fg',
      '--tone-critical-fg',
      '--tone-info-fg',
      '--tone-offline-fg',
    ],
  },
  {
    title: 'Chart series',
    tokens: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'],
  },
];

const typeScale = [
  ['--font-size-3xl', 'Page title · 30'],
  ['--font-size-2xl', 'Page title compact · 24'],
  ['--font-size-xl', 'Section heading · 20'],
  ['--font-size-lg', 'Card title · 17'],
  ['--font-size-base', 'Reading text · 15'],
  ['--font-size-md', 'Controls and tables · 14'],
  ['--font-size-sm', 'Secondary text · 13'],
  ['--font-size-xs', 'Captions and badges · 12'],
] as const;

const spaceScale = ['1', '2', '3', '4', '5', '6', '8', '10', '12', '16'];

const statusTones: [StatusTone, string][] = [
  ['positive', 'Approved'],
  ['informational', 'Open'],
  ['warning', 'Variance'],
  ['pending', 'Awaiting review'],
  ['critical', 'Rejected'],
  ['locked', 'Locked'],
  ['neutral', 'Draft'],
  ['offline', 'Offline draft'],
];

const tableRows = [
  {
    station: 'Station A',
    product: 'Diesel',
    litres: '12,480.000',
    value: 'USD 18,720.00',
    tone: 'positive',
    status: 'Reconciled',
  },
  {
    station: 'Station B',
    product: 'Petrol',
    litres: '9,105.250',
    value: 'USD 14,113.14',
    tone: 'warning',
    status: 'Variance',
  },
  {
    station: 'Station C',
    product: 'Diesel',
    litres: '4,002.500',
    value: 'USD 6,003.75',
    tone: 'pending',
    status: 'Awaiting review',
  },
  {
    station: 'Station D',
    product: 'Petrol',
    litres: '—',
    value: '—',
    tone: 'neutral',
    status: 'Not started',
  },
] as const;

export function DesignSystemReference() {
  const { preference, resolvedTheme, setPreference } = useThemePreference();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [wipOpen, setWipOpen] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(true);

  return (
    <div className={styles.root}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <PageContainer width="wide">
        <main id="main-content">
          <PageHeader
            eyebrow="Internal reference"
            title="Design system foundation"
            description="Tokens, primitives and states for Shanda Fuel. Synthetic content only."
            actions={
              <div className={styles.toolbar}>
                <Field id="theme-preference" label="Theme">
                  <Select
                    id="theme-preference"
                    value={preference}
                    onChange={(event) => {
                      if (isThemePreference(event.target.value)) setPreference(event.target.value);
                    }}
                    options={[
                      { value: 'system', label: `System (${resolvedTheme})` },
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                </Field>
              </div>
            }
          />

          <div className="stack stack-lg">
            <Section title="Needs attention" headingId="ref-attention">
              <div className={styles.twoCol}>
                <NeedsAttention
                  headingLevel={3}
                  limit={3}
                  items={[
                    {
                      id: 'a',
                      priority: 'warning',
                      title: 'Meter variance on Pump 3',
                      detail: 'Closing reading is 42.500 L above expected.',
                      meta: 'Station A · Morning shift',
                      action: (
                        <Button size="sm" variant="secondary">
                          Review
                        </Button>
                      ),
                    },
                    {
                      id: 'b',
                      priority: 'critical',
                      title: 'Business day not closed',
                      detail: 'Yesterday is still open and blocks today’s reconciliation.',
                      meta: 'Station B',
                      action: <Button size="sm">Close day</Button>,
                    },
                    {
                      id: 'c',
                      priority: 'info',
                      title: 'Delivery note uploaded',
                      meta: 'Station C · 2h ago',
                      dismissible: true,
                    },
                    {
                      id: 'd',
                      priority: 'info',
                      title: 'Hidden by limit',
                      dismissible: true,
                    },
                  ]}
                  viewAll={
                    <a className="text-link" href="#ref-attention">
                      View all
                    </a>
                  }
                />
                <NeedsAttention headingLevel={3} title="All clear" items={[]} />
              </div>
            </Section>

            <Section title="Colour" headingId="ref-colour" description="Semantic tokens only.">
              <div className="stack">
                {colourGroups.map((group) => (
                  <div key={group.title}>
                    <h3>{group.title}</h3>
                    <div className={styles.swatches}>
                      {group.tokens.map((token) => (
                        <div className={styles.swatch} key={token}>
                          <span
                            className={styles.swatchChip}
                            style={{ background: `var(${token})` }}
                          />
                          <code>{token}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Typography" headingId="ref-type">
              <Card className="card-body">
                {typeScale.map(([token, label]) => (
                  <div className={styles.typeRow} key={token}>
                    <span className="eyebrow">{token}</span>
                    <span style={{ fontSize: `var(${token})`, lineHeight: 1.25 }}>{label}</span>
                  </div>
                ))}
                <div className={styles.typeRow}>
                  <span className="eyebrow">Numeric (tabular)</span>
                  <span className="numeric">USD 1,234,567.89 · 12,480.000 L</span>
                </div>
              </Card>
            </Section>

            <Section title="Space, radius, elevation" headingId="ref-space">
              <div className={styles.twoCol}>
                <Card className="card-body stack stack-sm">
                  {spaceScale.map((step) => (
                    <div className={styles.scaleRow} key={step}>
                      <code>--space-{step}</code>
                      <span className={styles.spaceBar} style={{ width: `var(--space-${step})` }} />
                    </div>
                  ))}
                </Card>
                <div className="stack">
                  <div className={styles.tiles}>
                    {['xs', 'sm', 'md', 'lg', 'xl'].map((radius) => (
                      <div
                        className={styles.tile}
                        key={radius}
                        style={{ borderRadius: `var(--radius-${radius})` }}
                      >
                        radius-{radius}
                      </div>
                    ))}
                  </div>
                  <div className={styles.tiles}>
                    {['xs', 'sm', 'md', 'lg'].map((shadow) => (
                      <div
                        className={styles.tile}
                        key={shadow}
                        style={{
                          borderRadius: 'var(--radius-lg)',
                          boxShadow: `var(--shadow-${shadow})`,
                        }}
                      >
                        shadow-{shadow}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Buttons" headingId="ref-buttons">
              <Card className="card-body stack">
                <div className={styles.demoRow}>
                  <Button>Save draft</Button>
                  <Button variant="secondary">Export</Button>
                  <Button variant="quiet">Cancel</Button>
                  <Button variant="danger">Reverse entry</Button>
                  <Button loading>Saving</Button>
                  <Button disabled>Unavailable</Button>
                </div>
                <div className={styles.demoRow}>
                  <Button size="sm">Small</Button>
                  <Button size="sm" variant="secondary">
                    Small secondary
                  </Button>
                  <Button size="lg">Large primary</Button>
                  <IconButton icon="refresh" label="Refresh" />
                  <IconButton icon="bell" label="Notifications" variant="outlined" />
                  <IconButton icon="close" label="Close" size="sm" />
                </div>
              </Card>
            </Section>

            <Section title="Forms" headingId="ref-forms">
              <div className={styles.twoCol}>
                <Card className="card-body form-stack">
                  <Field id="ref-name" label="Reference" hint="Shown on the receipt." required>
                    <input id="ref-name" placeholder="e.g. DN-0142" />
                  </Field>
                  <Field id="ref-station" label="Station">
                    <Select
                      id="ref-station"
                      defaultValue=""
                      placeholder="Choose a station"
                      options={[
                        { value: 'a', label: 'Station A' },
                        { value: 'b', label: 'Station B' },
                      ]}
                    />
                  </Field>
                  <NumericInput
                    id="ref-litres"
                    label="Delivered quantity"
                    unit="L"
                    placeholder="0.000"
                  />
                  <Field
                    id="ref-reason"
                    label="Variance explanation"
                    error="An explanation is required for variances above tolerance."
                  >
                    <textarea id="ref-reason" />
                  </Field>
                  <Field
                    id="ref-disabled"
                    label="Business date"
                    hint="Set by the open business day."
                  >
                    <input id="ref-disabled" value="20 Sep 2026" disabled readOnly />
                  </Field>
                </Card>
                <Card className="card-body form-stack">
                  <Fieldset legend="Payment method">
                    <Radio name="ref-method" label="Cash" defaultChecked />
                    <Radio name="ref-method" label="Card" hint="Settled by the provider." />
                    <Radio name="ref-method" label="Account" disabled />
                  </Fieldset>
                  <Checkbox
                    label="Attach delivery note"
                    hint="Optional evidence for the receipt."
                  />
                  <Disclosure summary="More options">
                    <div className="form-stack">
                      <Field id="ref-notes" label="Internal note" optional>
                        <input id="ref-notes" />
                      </Field>
                    </div>
                  </Disclosure>
                  <div className="form-actions form-actions-end">
                    <Button variant="quiet">Cancel</Button>
                    <Button type="submit">Save draft</Button>
                  </div>
                </Card>
              </div>
            </Section>

            <Section
              title="Table"
              headingId="ref-table"
              description="Dense, hairline rows, tabular numbers."
            >
              <Card className="card-body table-card">
                <TableScrollRegion label="Synthetic station reconciliation summary">
                  <table className="responsive-table table-hover">
                    <caption className="visually-hidden">
                      Synthetic station reconciliation summary
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Station</th>
                        <th scope="col">Product</th>
                        <th scope="col" className="cell-numeric">
                          Litres
                        </th>
                        <th scope="col" className="cell-numeric">
                          Value
                        </th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((row) => (
                        <tr key={row.station}>
                          <td data-label="Station">{row.station}</td>
                          <td data-label="Product" className="cell-muted">
                            {row.product}
                          </td>
                          <td data-label="Litres" className="cell-numeric">
                            {row.litres}
                          </td>
                          <td data-label="Value" className="cell-numeric">
                            {row.value}
                          </td>
                          <td data-label="Status">
                            <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollRegion>
              </Card>
            </Section>

            <Section title="Badges" headingId="ref-badges">
              <div className={styles.demoRow}>
                {statusTones.map(([tone, label]) => (
                  <StatusBadge key={tone} tone={tone}>
                    {label}
                  </StatusBadge>
                ))}
                <WipBadge />
              </div>
            </Section>

            <Section title="Notices" headingId="ref-notices">
              <div className="stack">
                {noticeVisible ? (
                  <Notice
                    tone="info"
                    title="Prices change at midnight"
                    onDismiss={() => setNoticeVisible(false)}
                  >
                    New pump prices apply from the next business day.
                  </Notice>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setNoticeVisible(true)}>
                    Show dismissed notice
                  </Button>
                )}
                <Notice tone="positive" title="Reconciliation submitted" />
                <Notice tone="warning" title="Variance above tolerance">
                  Explain the variance before submitting for review.
                </Notice>
                <Notice
                  tone="critical"
                  title="Could not save"
                  actions={
                    <Button size="sm" variant="secondary">
                      Try again
                    </Button>
                  }
                >
                  The server did not confirm the change. Nothing was posted.
                </Notice>
                <Notice tone="offline">Offline. Drafts are kept on this device only.</Notice>
              </div>
            </Section>

            <Section title="Dialogs" headingId="ref-dialogs">
              <div className={styles.demoRow}>
                <Button variant="secondary" onClick={() => setModalOpen(true)}>
                  Open dialog
                </Button>
                <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                  Reverse receipt
                </Button>
                <Button variant="secondary" onClick={() => setWipOpen(true)}>
                  Open WIP dialog
                </Button>
                <WorkInProgressTrigger feature="Supplier statements">
                  <a className="text-link" href="#ref-dialogs">
                    Supplier statements (WIP trigger)
                  </a>
                </WorkInProgressTrigger>
              </div>
              <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title="Edit delivery"
                description="Changes stay in draft until submitted."
                footer={
                  <>
                    <Button variant="secondary" onClick={() => setModalOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={() => setModalOpen(false)}>Save draft</Button>
                  </>
                }
              >
                <div className="form-stack">
                  <NumericInput id="ref-modal-litres" label="Delivered quantity" unit="L" />
                </div>
              </Modal>
              <ConfirmDialog
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={() => {
                  setConfirmPending(true);
                  window.setTimeout(() => {
                    setConfirmPending(false);
                    setConfirmOpen(false);
                  }, 1200);
                }}
                pending={confirmPending}
                tone="danger"
                title="Reverse this receipt?"
                consequence="A reversing entry will be posted. The original receipt stays in the audit trail and cannot be edited."
                details={[
                  { label: 'Station', value: 'Station A' },
                  { label: 'Business date', value: '20 Sep 2026' },
                  { label: 'Amount', value: 'USD 1,250.00' },
                ]}
                acknowledgement="I understand this posts a reversal."
                confirmLabel="Reverse receipt"
              />
              <WorkInProgressDialog
                open={wipOpen}
                onClose={() => setWipOpen(false)}
                feature="Bank reconciliation"
              />
            </Section>

            <Section title="States" headingId="ref-states">
              <div className={styles.twoCol}>
                <Card className="card-body stack">
                  <LoadingState label="Loading reconciliation" />
                  <Skeleton lines={4} />
                  <div className={styles.demoRow}>
                    <SkeletonBlock width="2.5rem" height="2.5rem" shape="circle" />
                    <SkeletonBlock width="60%" height="1.25rem" />
                  </div>
                  <EmptyState
                    title="No deliveries yet"
                    message="Deliveries recorded today will appear here."
                  />
                  <ErrorState
                    message="The latest data could not be loaded."
                    action={
                      <Button size="sm" variant="secondary">
                        Retry
                      </Button>
                    }
                  />
                </Card>
                <div className="stack">
                  <Card>
                    <EmptyState
                      layout="block"
                      title="No reports for this period"
                      message="Choose another period or station to see posted reports."
                      action={<Button variant="secondary">Change period</Button>}
                    />
                  </Card>
                  <Card>
                    <ErrorState
                      layout="block"
                      title="Reports unavailable"
                      message="We could not reach the server. Your work is safe."
                      action={<Button variant="secondary">Try again</Button>}
                    />
                  </Card>
                  <WorkInProgressPanel feature="Customer statements" />
                </div>
              </div>
            </Section>

            <Section title="Metrics" headingId="ref-metrics">
              <div className="metric-grid">
                <MetricCard label="Litres sold" value="24,380.500" meta="Today, all products" />
                <MetricCard label="Cash to bank" value="USD 31,204.00" meta="2 deposits pending" />
                <MetricCard
                  label="Unexplained variance"
                  value="42.500 L"
                  meta="Pump 3"
                  tone="critical"
                />
              </div>
            </Section>

            <Section
              title="Chart rules"
              headingId="ref-charts"
              description="No chart library yet. Charts must use these tokens, one question per chart, max five series, hairline grid, and a text or table equivalent."
            >
              <Card className="card-body chart">
                <div className="chart-header">
                  <h3 className="chart-title">Series tokens</h3>
                  <ul className="chart-legend">
                    {[1, 2, 3, 4, 5].map((index) => (
                      <li key={index}>
                        <span
                          className="chart-swatch"
                          style={{ ['--swatch' as string]: `var(--chart-${index})` }}
                        />
                        Series {index}
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            </Section>
          </div>
        </main>
      </PageContainer>
    </div>
  );
}
