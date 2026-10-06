'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';

import { AppShell } from '@/design-system/app-shell';
import type { NavigationProjection } from '@/design-system/navigation';
import { Card, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';

const DEMO_EMAIL = 'demo-owner@tei-oils.example.test';
const SESSION_KEY = 'shanda-fuel-owner-demo-authenticated';
const AUTH_EVENT = 'shanda-fuel-owner-demo-auth-changed';

const stations = [
  {
    id: 'bindura',
    name: 'Bindura',
    sales: '14,820.50',
    expected: '8,420.00',
    actual: '8,365.00',
    cashVariance: '-55.00',
    stockVariance: '-125 L',
    account: '2,110.00',
    exceptions: 2,
    close: 'Awaiting supervisor',
  },
  {
    id: 'maruta',
    name: 'Maruta',
    sales: '11,640.00',
    expected: '6,890.00',
    actual: '6,890.00',
    cashVariance: '0.00',
    stockVariance: '+18 L',
    account: '1,480.00',
    exceptions: 0,
    close: 'Ready to review',
  },
  {
    id: 'arcturus',
    name: 'Arcturus',
    sales: '18,205.75',
    expected: '10,120.00',
    actual: '10,004.50',
    cashVariance: '-115.50',
    stockVariance: '-42 L',
    account: '3,260.00',
    exceptions: 1,
    close: 'Exception open',
  },
  {
    id: 'gazebo',
    name: 'Gazebo',
    sales: '9,430.25',
    expected: '5,610.00',
    actual: '5,610.00',
    cashVariance: '0.00',
    stockVariance: '+7 L',
    account: '920.00',
    exceptions: 0,
    close: 'Closed',
  },
] as const;

type Station = (typeof stations)[number];
type View = 'dashboard' | 'sales' | 'reconciliation' | 'reports';

const demoNavigation: readonly NavigationProjection[] = [];

export function OwnerDemoApp() {
  const authenticated = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(AUTH_EVENT, onChange);
      return () => window.removeEventListener(AUTH_EVENT, onChange);
    },
    () => window.sessionStorage.getItem(SESSION_KEY) === 'true',
    () => false,
  );

  if (!authenticated) {
    return <OwnerDemoLogin />;
  }

  return (
    <OwnerDemoWorkspace
      onSignOut={() => {
        window.sessionStorage.removeItem(SESSION_KEY);
        window.dispatchEvent(new Event(AUTH_EVENT));
      }}
    />
  );
}

function OwnerDemoLogin() {
  const [error, setError] = useState<string>();

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase();
    const password = String(form.get('password') ?? '');

    if (email !== DEMO_EMAIL || password.length < 12) {
      setError('Use the synthetic demo email and a 12+ character demo password.');
      return;
    }

    window.sessionStorage.setItem(SESSION_KEY, 'true');
    window.dispatchEvent(new Event(AUTH_EVENT));
  }

  return (
    <main className="auth-layout" data-testid="owner-demo-login">
      <div className="auth-panel">
        <div className="shell-brand">
          <span className="brand-mark" aria-hidden="true">
            SF
          </span>
          <span className="shell-brand-text">
            <span className="brand-name">Shanda Fuel</span>
            <span className="brand-byline">Owner demo · synthetic data</span>
          </span>
        </div>
        <Card as="section" className="auth-card" aria-labelledby="owner-demo-login-title">
          <div className="section-heading">
            <p className="eyebrow">Demo environment</p>
            <h1 id="owner-demo-login-title">Sign in to the owner demo</h1>
            <p>Use the synthetic Owner/Admin identity supplied for this walkthrough.</p>
          </div>
          <form className="demo-form" onSubmit={signIn}>
            <div className="field">
              <label htmlFor="owner-demo-email">Email</label>
              <input
                id="owner-demo-email"
                name="email"
                type="email"
                defaultValue={DEMO_EMAIL}
                required
                autoComplete="username"
              />
            </div>
            <div className="field">
              <label htmlFor="owner-demo-password">Demo password</label>
              <input
                id="owner-demo-password"
                name="password"
                type="password"
                required
                minLength={12}
                autoComplete="current-password"
              />
              <p className="field-hint">
                Synthetic only; this value stays in this browser session.
              </p>
            </div>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="button button-primary" type="submit">
              Open owner demo
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}

function OwnerDemoWorkspace({ onSignOut }: { onSignOut: () => void }) {
  const [view, setView] = useState<View>('dashboard');
  const [stationId, setStationId] = useState<string>(stations[0].id);
  const station = stations.find((item) => item.id === stationId) ?? stations[0];

  return (
    <AppShell
      navigationProjection={demoNavigation}
      context={{
        organisation: 'T.E.I Oils',
        station: station.name,
        businessDate: '06 Oct 2026',
        timeZone: 'Africa/Harare',
      }}
      role="Owner / Admin"
      userName="Demo owner"
      searchPlacement="none"
      pageSubtitle="Operational control and exception visibility"
      contextSelectorMode="static"
      brandHref="/owner-demo"
    >
      <div className="page-header">
        <div>
          <p className="eyebrow">Synthetic owner demo · Triumph Energy</p>
          <h1>How is the operation performing today?</h1>
          <p className="lede">
            A safe, browser-local preview across your four authorised stations.
          </p>
        </div>
        <div className="page-header-actions">
          <StatusBadge tone="informational">Demo · no database</StatusBadge>
          <button className="button button-secondary" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="content-grid" data-testid="owner-demo-workspace">
        <Card as="section" className="content-span" aria-labelledby="demo-context-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Authorised scope</p>
              <h2 id="demo-context-title">T.E.I Oils · Triumph Energy</h2>
            </div>
            <label
              className="field"
              htmlFor="demo-station"
              style={{ minWidth: '14rem', marginBottom: 0 }}
            >
              <span>Active station</span>
              <select
                id="demo-station"
                value={station.id}
                onChange={(event) => setStationId(event.target.value)}
              >
                {stations.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <nav aria-label="Owner demo navigation" className="cluster">
            {(
              [
                ['dashboard', 'Today'],
                ['sales', 'Sales'],
                ['reconciliation', 'Cash & reconciliation'],
                ['reports', 'Reports'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={`button ${view === key ? 'button-primary' : 'button-quiet'}`}
                type="button"
                aria-current={view === key ? 'page' : undefined}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </nav>
        </Card>

        {view === 'dashboard' ? <Dashboard station={station} /> : null}
        {view === 'sales' ? <Sales station={station} /> : null}
        {view === 'reconciliation' ? <Reconciliation station={station} /> : null}
        {view === 'reports' ? <Reports /> : null}
      </div>
    </AppShell>
  );
}

function Dashboard({ station }: { station: Station }) {
  const metrics = [
    ['Today’s sales', `$${station.sales}`],
    ['Expected cash', `$${station.expected}`],
    ['Actual cash', `$${station.actual}`],
    ['Cash variance', `$${station.cashVariance}`],
    ['Fuel / stock variance', station.stockVariance],
    ['Account sales', `$${station.account}`],
    ['Unresolved exceptions', String(station.exceptions)],
    ['Shift close', station.close],
  ];
  return (
    <>
      <section className="metric-grid" aria-label="Today’s operational metrics">
        {metrics.map(([label, value]) => (
          <Card className="metric-card" key={label}>
            <span className="metric-label">{label}</span>
            <strong className="metric-value numeric">{value}</strong>
            <span className="metric-meta">Synthetic Phase 0 fixture</span>
          </Card>
        ))}
      </section>
      <Card as="section" className="content-span" aria-labelledby="attention-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Exception visibility</p>
            <h2 id="attention-title">What needs your attention</h2>
          </div>
          <StatusBadge tone={station.exceptions ? 'warning' : 'positive'}>
            {station.exceptions ? `${station.exceptions} open` : 'Clear'}
          </StatusBadge>
        </div>
        <TableScrollRegion label="Synthetic owner-demo exceptions">
          <table className="responsive-table">
            <caption className="visually-hidden">Synthetic attention items</caption>
            <thead>
              <tr>
                <th>Item</th>
                <th>Station</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td data-label="Item">Cash close review</td>
                <td data-label="Station">{station.name}</td>
                <td data-label="State">
                  <StatusBadge tone="warning">Awaiting review</StatusBadge>
                </td>
              </tr>
              <tr>
                <td data-label="Item">Stock variance explanation</td>
                <td data-label="Station">{station.name}</td>
                <td data-label="State">
                  <StatusBadge tone={station.exceptions ? 'critical' : 'positive'}>
                    {station.exceptions ? 'Needs attention' : 'Within threshold'}
                  </StatusBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </TableScrollRegion>
      </Card>
    </>
  );
}

function Sales({ station }: { station: Station }) {
  return (
    <Card as="section" className="content-span" aria-labelledby="sales-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Posted synthetic evidence</p>
          <h2 id="sales-title">Sales · {station.name}</h2>
        </div>
        <StatusBadge tone="positive">Posted</StatusBadge>
      </div>
      <p className="lede">
        Normal station selling prices; no tax, margin, or accounting calculation is inferred in this
        demo.
      </p>
      <TableScrollRegion label="Synthetic sales evidence">
        <table className="responsive-table">
          <caption className="visually-hidden">Synthetic posted sales</caption>
          <thead>
            <tr>
              <th>Business date</th>
              <th>Product</th>
              <th>Litres</th>
              <th>Sales value</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label="Business date">06 Oct 2026</td>
              <td data-label="Product">Unleaded petrol 95</td>
              <td data-label="Litres" className="numeric">
                1,842.500
              </td>
              <td data-label="Sales value" className="numeric">
                $8,210.50
              </td>
              <td data-label="Payment">Cash / POS</td>
            </tr>
            <tr>
              <td data-label="Business date">06 Oct 2026</td>
              <td data-label="Product">Diesel 50 ppm</td>
              <td data-label="Litres" className="numeric">
                1,420.000
              </td>
              <td data-label="Sales value" className="numeric">
                $6,610.00
              </td>
              <td data-label="Payment">Account</td>
            </tr>
          </tbody>
        </table>
      </TableScrollRegion>
    </Card>
  );
}

function Reconciliation({ station }: { station: Station }) {
  return (
    <>
      <section className="metric-grid" aria-label="Cash and stock reconciliation">
        <Card className="metric-card">
          <span className="metric-label">Expected cash</span>
          <strong className="metric-value numeric">${station.expected}</strong>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Actual cash</span>
          <strong className="metric-value numeric">${station.actual}</strong>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Cash variance</span>
          <strong className="metric-value numeric">${station.cashVariance}</strong>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Stock variance</span>
          <strong className="metric-value numeric">{station.stockVariance}</strong>
        </Card>
      </section>
      <Card as="section" className="content-span" aria-labelledby="close-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Supervisor review</p>
            <h2 id="close-title">Shift/day close status</h2>
          </div>
          <StatusBadge tone="pending">{station.close}</StatusBadge>
        </div>
        <p>
          This synthetic evidence illustrates the review boundary. It does not post cash, bank,
          inventory, or accounting records.
        </p>
        <button className="button button-secondary" type="button">
          Review close evidence
        </button>
      </Card>
    </>
  );
}

function Reports() {
  return (
    <Card as="section" className="content-span" aria-labelledby="reports-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Reporting artifact</p>
          <h2 id="reports-title">Station summary</h2>
        </div>
        <StatusBadge tone="informational">Synthetic</StatusBadge>
      </div>
      <p>Compare supported operational facts across the four authorised stations.</p>
      <TableScrollRegion label="Synthetic station summary">
        <table className="responsive-table">
          <caption className="visually-hidden">Synthetic station report</caption>
          <thead>
            <tr>
              <th>Station</th>
              <th>Sales</th>
              <th>Cash variance</th>
              <th>Exceptions</th>
              <th>Close</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((station) => (
              <tr key={station.id}>
                <td data-label="Station">{station.name}</td>
                <td data-label="Sales" className="numeric">
                  ${station.sales}
                </td>
                <td data-label="Cash variance" className="numeric">
                  ${station.cashVariance}
                </td>
                <td data-label="Exceptions">{station.exceptions}</td>
                <td data-label="Close">{station.close}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
    </Card>
  );
}
