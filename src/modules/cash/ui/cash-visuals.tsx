'use client';

import { useState } from 'react';

import { formatTileMoney } from '../../reporting/format';

type WalletAccount = {
  bankAccountId: string;
  name: string;
  bankName: string;
  accountReferenceMasked: string;
};

const SCALE = 6;

/** Stand-in shown for every money amount while amounts are hidden. */
export const MASK = '••••••';

/** Exact decimal sum of money strings, returned as a plain decimal string. */
export function sumDecimals(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) total += toScaled(value);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE).replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function toScaled(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return 0n;
  const [, sign, whole = '0', fraction = ''] = match;
  const scaled = BigInt(whole + fraction.slice(0, SCALE).padEnd(SCALE, '0'));
  return sign ? -scaled : scaled;
}

/** Brand colour and logo for the banks we recognise by name; others keep the neutral tones. */
const BANK_BRANDS = [
  { id: 'cbz', match: /\bcbz\b/i, logo: '/banks/cbz-mark.png' },
  { id: 'stanbic', match: /stanbic/i, logo: '/banks/stanbic-mark.png' },
  { id: 'fbc', match: /\bfbc\b/i, logo: '/banks/fbc-mark.png' },
] as const;

function brandFor(bankName: string) {
  return BANK_BRANDS.find((brand) => brand.match.test(bankName));
}

type WalletDeposit = { bankAccountId: string; amount: string };

/** Cards behind the front one that stay visible as strips. */
const MAX_VISIBLE = 4;

/**
 * A wallet holding the station's linked bank accounts as stacked cards, with the
 * cash held at the station in the pocket. Choosing a card (a strip or the arrow) brings it to the front; the pocket amount can be hidden. Presentation
 * only: every figure comes from the cash summary unchanged.
 */
export function CashWallet({
  accounts,
  deposits,
  amount,
  currency,
  hidden,
  onToggleHidden,
}: {
  accounts: readonly WalletAccount[];
  deposits: readonly WalletDeposit[];
  amount: string;
  currency: string;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const count = accounts.length;
  const active = count === 0 ? 0 : Math.min(selected, count - 1);
  const visible = Math.min(Math.max(count, 1), MAX_VISIBLE);
  const shift = Math.min((MAX_VISIBLE - visible) * 40, 85);
  const current = accounts[active];
  const forAccount = current
    ? deposits.filter((deposit) => deposit.bankAccountId === current.bankAccountId)
    : [];

  return (
    <div className="cash-wallet-block">
      <div className="cash-wallet" style={{ '--s': shift } as React.CSSProperties}>
        <div className="cash-wallet-stage">
          <span className="cash-wallet-shell" aria-hidden="true" />
          {count === 0 ? (
            <div
              className="cash-wallet-card cash-wallet-card-front"
              data-tone="0"
              data-empty="true"
            >
              <span className="cash-wallet-card-name">No bank account linked</span>
            </div>
          ) : (
            accounts.map((account, index) => {
              const position = (index - active + count) % count;
              const isFront = position === 0;
              const style = {
                '--pos': Math.min(position, MAX_VISIBLE - 1),
                zIndex: MAX_VISIBLE + 1 - Math.min(position, MAX_VISIBLE),
              } as React.CSSProperties;
              const tone = index % 5;
              const brand = brandFor(account.bankName);
              const state = position >= MAX_VISIBLE ? 'hidden' : isFront ? 'front' : 'behind';
              return isFront ? (
                <div
                  key={account.bankAccountId}
                  className="cash-wallet-card cash-wallet-card-front"
                  data-tone={tone}
                  data-brand={brand?.id}
                  data-state={state}
                  style={style}
                >
                  {brand ? (
                    <span className="cash-wallet-logo" data-solo={count === 1 ? 'true' : undefined}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
                      <img src={brand.logo} alt="" />
                    </span>
                  ) : null}
                  <span className="cash-wallet-card-name">
                    {account.name}
                    <small> · {account.bankName}</small>
                  </span>
                  <span className="cash-wallet-card-ref">{account.accountReferenceMasked}</span>
                  {count > 1 ? (
                    <button
                      type="button"
                      className="cash-wallet-next"
                      aria-label="Show next bank account"
                      onClick={() => setSelected((active + 1) % count)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M7 17 17 7M9 7h8v8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  key={account.bankAccountId}
                  type="button"
                  className="cash-wallet-card cash-wallet-card-behind"
                  data-tone={tone}
                  data-brand={brand?.id}
                  data-state={state}
                  style={style}
                  tabIndex={state === 'hidden' ? -1 : 0}
                  aria-hidden={state === 'hidden' ? true : undefined}
                  aria-label={`Show ${account.name}, ${account.bankName}`}
                  onClick={() => setSelected(index)}
                >
                  <span className="cash-wallet-strip">
                    {account.bankName}
                    {brand ? (
                      <span className="cash-wallet-logo cash-wallet-logo-strip">
                        {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
                        <img src={brand.logo} alt="" />
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
          <svg
            className="cash-wallet-pocket-shape"
            viewBox="0 0 557 265"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id="cash-pocket-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" style={{ stopColor: 'var(--pocket-top)' }} />
                <stop offset="1" style={{ stopColor: 'var(--pocket-bottom)' }} />
              </linearGradient>
            </defs>
            <path className="cash-pocket-body" d={POCKET} fill="url(#cash-pocket-fill)" />
            <path className="cash-pocket-stitch" d={POCKET} transform={STITCH} fill="none" />
          </svg>
          <div className="cash-wallet-pocket">
            <strong className="cash-wallet-amount" aria-live="polite">
              {hidden ? `${currency} ${MASK}` : formatTileMoney(amount, currency)}
            </strong>
            <span className="cash-wallet-caption">Cash at station</span>
            <button
              type="button"
              className="cash-wallet-eye"
              aria-pressed={hidden}
              aria-label={hidden ? 'Show money amounts' : 'Hide money amounts'}
              onClick={onToggleHidden}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <path
                  d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                {hidden ? (
                  <path
                    d="M4 4l16 16"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                ) : null}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {current ? (
        <p className="cash-wallet-detail">
          <strong>{current.name}</strong>
          <span>
            {forAccount.length === 0
              ? 'No deposits to this account yet'
              : `${forAccount.length} ${forAccount.length === 1 ? 'deposit' : 'deposits'} · ${
                  hidden
                    ? `${currency} ${MASK}`
                    : formatTileMoney(
                        sumDecimals(forAccount.map((deposit) => deposit.amount)),
                        currency,
                      )
                }`}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Pocket outline in a 557 x 265 box: a narrow top with sloped shoulders flaring to the body. */
const POCKET =
  'M57 14 Q57 0 71 0 H486 Q500 0 500 14 C500 30 518 42 536 46 Q557 51 557 72 V205 Q557 265 497 265 H60 Q0 265 0 205 V72 Q0 51 21 46 C39 42 57 30 57 14 Z';
const STITCH = 'translate(278.5 132.5) scale(0.955 0.93) translate(-278.5 -132.5)';

export type DonutSlice = {
  key: string;
  label: string;
  total: string;
  count: number;
  /** Replaces the collection count under the label. */
  detail?: string;
  /** Replaces the formatted amount on the right of the legend row, for slices that are counts. */
  display?: string;
  /** Colour slot: 0 teal, 1 blue, 2 yellow, 3 indigo, 4 pink, 5 orange. */
  tone: number;
};

const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 4;

/**
 * Ring of the station's collections split by custody state. Slice sizes are
 * presentation only; the legend carries the exact amounts.
 */
export function CashDonut({
  slices,
  currency,
  centreLabel,
  centreValue,
  hidden = false,
  onSelect,
  selectOpensDialog = true,
  emptyMessage = 'Collections appear here once cash from an approved reconciliation is recorded.',
}: {
  slices: readonly DonutSlice[];
  currency: string;
  centreLabel: string;
  centreValue: string;
  hidden?: boolean;
  onSelect?: (key: string) => void;
  /** False when choosing a row filters the page instead of opening a dialog. */
  selectOpensDialog?: boolean;
  emptyMessage?: string;
}) {
  const weights = slices.map((slice) => Math.max(Number(slice.total), 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  let offset = 0;

  return (
    <div className="cash-donut">
      <div className="cash-donut-ring">
        <svg viewBox="0 0 140 140" aria-hidden="true" focusable="false">
          {sum > 0 ? null : <circle className="cash-donut-track" cx="70" cy="70" r={RADIUS} />}
          {sum > 0
            ? slices.map((slice, index) => {
                const share = (weights[index] ?? 0) / sum;
                if (share <= 0) return null;
                const length = Math.max(share * CIRCUMFERENCE - (slices.length > 1 ? GAP : 0), 0.5);
                const dashoffset = -offset;
                offset += share * CIRCUMFERENCE;
                return (
                  <circle
                    key={slice.key}
                    className="cash-donut-slice"
                    data-tone={slice.tone}
                    cx="70"
                    cy="70"
                    r={RADIUS}
                    strokeDasharray={`${length} ${CIRCUMFERENCE}`}
                    strokeDashoffset={dashoffset}
                  />
                );
              })
            : null}
        </svg>
        <div className="cash-donut-centre">
          <strong>{centreValue}</strong>
          <span>{centreLabel}</span>
        </div>
      </div>
      {slices.length === 0 ? (
        <p className="cash-donut-empty">{emptyMessage}</p>
      ) : (
        <ul className="cash-donut-legend">
          {slices.map((slice) => (
            <li key={slice.key}>
              {(() => {
                const row = (
                  <>
                    <span className="cash-donut-dot" data-tone={slice.tone} aria-hidden="true" />
                    <span className="cash-donut-name">
                      {slice.label}
                      <small>
                        {slice.detail ??
                          `${slice.count} ${slice.count === 1 ? 'collection' : 'collections'}`}
                      </small>
                    </span>
                    <span className="cash-donut-value">
                      {slice.display ??
                        (hidden ? `${currency} ${MASK}` : formatTileMoney(slice.total, currency))}
                    </span>
                  </>
                );
                return onSelect ? (
                  <button
                    type="button"
                    className="cash-donut-row"
                    onClick={() => onSelect(slice.key)}
                    aria-haspopup={selectOpensDialog ? 'dialog' : undefined}
                  >
                    {row}
                  </button>
                ) : (
                  <div className="cash-donut-row" data-static="true">
                    {row}
                  </div>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
