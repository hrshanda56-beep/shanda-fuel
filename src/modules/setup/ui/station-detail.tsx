'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { Icon } from '@/design-system/icons';
import { formatUnitPrice } from '@/design-system/formatters';
import {
  AccessDeniedState,
  Button,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { CardEmpty, CardRow, CardRows, SectionCard } from '@/design-system/section-card';
import { EditStation } from '@/modules/settings/ui/structure-forms';
import type { SettingsStation } from '@/modules/settings/contracts';
import type { StaffOverview } from '@/modules/staff/contracts';

import type { StationReadiness } from '../contracts';

import { buildStationOverview, type StationFuelRow } from '../station-overview';
import {
  NewStationGuide,
  StationStaging,
  StationWizardPage,
  useStagedStation,
  useStationConfig,
  useStationGuiding,
  type WizardPart,
} from './guided-setup-panel';
import styles from './station-detail.module.css';
import { useSetupOverview } from './use-setup-overview';

/** Stations as a list: the whole row opens the station, with a plain note on what is left to do. */
export function StationList({
  stations,
  canSeeReadiness,
  onOpen,
}: {
  stations: readonly SettingsStation[];
  canSeeReadiness: boolean;
  onOpen: (stationId: string) => void;
}) {
  const { state } = useSetupOverview();
  const readiness = state.kind === 'ready' ? state.overview.stations : [];
  return (
    <StationCards
      stations={stations}
      readiness={readiness}
      canSeeReadiness={canSeeReadiness}
      onOpen={onOpen}
    />
  );
}

/** The station cards themselves, shared by the Stations list and the Readiness check. */
export function StationCards({
  stations,
  readiness,
  canSeeReadiness,
  onOpen,
}: {
  stations: readonly SettingsStation[];
  readiness: readonly StationReadiness[];
  canSeeReadiness: boolean;
  onOpen: (stationId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? stations.filter((station) => `${station.name} ${station.code}`.toLowerCase().includes(needle))
    : stations;
  return (
    <div className={styles.listWrap}>
      {stations.length > 1 ? (
        <label className={styles.search}>
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search stations…"
            aria-label="Search stations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}
      {shown.length === 0 ? (
        <p className={styles.muted}>No station matches “{query.trim()}”.</p>
      ) : null}
      <ul className={styles.cards} aria-label="Stations">
        {shown.map((station) => {
          const settingUp = station.status === 'ONBOARDING';
          const found = readiness.find((item) => item.stationId === station.id);
          const left = found?.missing.length ?? 0;
          const note =
            canSeeReadiness && left > 0
              ? `${left} ${left === 1 ? 'thing' : 'things'} to do`
              : settingUp
                ? 'Still being set up'
                : 'All set up';
          return (
            <li key={station.id}>
              <button
                type="button"
                className={`${styles.card} ${settingUp ? styles.cardPending : ''}`.trim()}
                onClick={() => onOpen(station.id)}
              >
                <span className={styles.cardTop}>
                  <span className={styles.cardIcon} aria-hidden="true">
                    <Icon name="station" />
                  </span>
                  <StatusBadge tone={settingUp ? 'pending' : 'positive'}>
                    {settingUp ? 'Setting up' : 'Live'}
                  </StatusBadge>
                </span>
                <span className={styles.cardName}>{station.name}</span>
                <span className={styles.cardFoot}>
                  <span className={styles.muted}>{note}</span>
                  <Icon name="chevron-right" className={styles.chevron} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One station on its own page: the fuels it sells with their prices, tanks and pumps, then the
 * whole station (shifts and who is in charge). Changing anything opens a wizard, one question per
 * screen, so nothing is edited in place and there is no separate editing screen.
 */
type StationDetailProps = {
  tenantId: string;
  station: SettingsStation;
  canSetUp: boolean;
  canEditDetails: boolean;
  /** Opens straight on correcting a meter start day, e.g. from a blocked shift close. */
  focus?: 'meter-start' | 'prices';
  staff?: StaffOverview;
  onBack: () => void;
  onOpenStaff: () => void;
};

/**
 * Reads the station and, for people who may change it, holds the changes waiting to be saved for
 * the whole page, so they survive while wizards open and close.
 */
export function StationDetail(props: StationDetailProps) {
  const { state, refresh } = useStationConfig(props.tenantId, props.station.id);
  if (state.kind === 'ready' && props.canSetUp) {
    return (
      <StationStaging
        tenantId={props.tenantId}
        stationId={props.station.id}
        serverData={state.data}
        refresh={refresh}
      >
        <StationDetailView {...props} state={state} refresh={refresh} />
      </StationStaging>
    );
  }
  return <StationDetailView {...props} state={state} refresh={refresh} />;
}

function StationDetailView({
  tenantId,
  station,
  canSetUp,
  canEditDetails,
  focus,
  staff,
  onBack,
  onOpenStaff,
  state,
  refresh,
}: StationDetailProps & {
  state: ReturnType<typeof useStationConfig>['state'];
  refresh: () => void;
}) {
  const staged = useStagedStation();
  const guiding = useStationGuiding();
  /** The wizard page showing over the station, if any. */
  const [wizard, setWizard] = useState<WizardPart>();
  const [meterHandled, setMeterHandled] = useState(false);
  /** The fuel whose own page is showing; none means the station page. */
  const [fuelId, setFuelId] = useState<string>();
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const todoMenu = useRef<HTMLDivElement>(null);
  const settingUp = station.status === 'ONBOARDING';

  useEffect(() => {
    if (!todoOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !todoMenu.current?.contains(event.target))
        setTodoOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setTodoOpen(false);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [todoOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setMoreOpen(false);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [moreOpen]);

  const shown = state.kind === 'ready' ? (staged ?? state.data) : null;
  const overview = shown ? buildStationOverview(shown) : null;
  const openFuel =
    overview && fuelId ? overview.fuels.find((row) => row.productId === fuelId) : undefined;
  const showFuel = Boolean(openFuel);
  const hiddenFuels = (shown?.products ?? []).filter((p) => p.status !== 'ACTIVE');

  // Coming from a blocked shift close: the pumps wizard of the fuel whose meter start day can still
  // be corrected opens first, once the station has been read, until it is closed.
  const meterNozzle =
    focus === 'meter-start' && canSetUp && !meterHandled
      ? (shown?.nozzles ?? []).find((n) => n.meterWorkingSinceEditable)
      : undefined;
  // Coming from "Change a price" on Daily Operations: the one fuel's price wizard, or a choice of fuel.
  const activeFuels = (shown?.products ?? []).filter((p) => p.status === 'ACTIVE');
  const priceStart: WizardPart | undefined =
    focus === 'prices' && canSetUp && !meterHandled && shown && activeFuels.length > 0
      ? activeFuels.length === 1
        ? { kind: 'price', productId: activeFuels[0]!.id }
        : { kind: 'pickPrice' }
      : undefined;
  const activeWizard: WizardPart | undefined =
    wizard ??
    (meterNozzle
      ? { kind: 'pumps', productId: meterNozzle.productId, meterStart: true }
      : priceStart);

  return (
    <div className={styles.page}>
      <div>
        <Button variant="quiet" size="sm" onClick={showFuel ? () => setFuelId(undefined) : onBack}>
          {showFuel ? '← All fuels' : '← All stations'}
        </Button>
      </div>
      {showFuel ? null : (
        <div className={`${styles.head} ${styles.headCard}`}>
          <div className={styles.headMain}>
            <span className={styles.cardIcon} aria-hidden="true">
              <Icon name="station" />
            </span>
            <h2 className={styles.title}>{station.name}</h2>
            <StatusBadge tone={settingUp ? 'pending' : 'positive'}>
              {settingUp ? 'Setting up' : 'Live'}
            </StatusBadge>
          </div>
          <div className={styles.actions}>
            {overview && overview.todo.length > 0 ? (
              <div className={styles.more} ref={todoMenu}>
                <button
                  type="button"
                  className={styles.bell}
                  aria-haspopup="dialog"
                  aria-expanded={todoOpen}
                  aria-label={`Still to do: ${overview.todo.length} ${overview.todo.length === 1 ? 'thing' : 'things'}`}
                  onClick={() => setTodoOpen((open) => !open)}
                >
                  <Icon name="bell" />
                  <span className={styles.bellCount} aria-hidden="true">
                    {overview.todo.length}
                  </span>
                </button>
                {todoOpen ? (
                  <div
                    className={`${styles.moreMenu} ${styles.todoMenu}`}
                    role="dialog"
                    aria-label="Still to do"
                  >
                    <strong>Still to do</strong>
                    <ul>
                      {overview.todo.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className={styles.more} ref={menu}>
              <Button
                variant="secondary"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                More ▾
              </Button>
              {moreOpen ? (
                <div className={styles.moreMenu} role="menu">
                  {canEditDetails ? (
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setMoreOpen(false);
                        setDetailsOpen(true);
                      }}
                    >
                      Edit name and time zone
                    </Button>
                  ) : null}
                  {staff ? (
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setMoreOpen(false);
                        onOpenStaff();
                      }}
                    >
                      Who works here
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {canEditDetails ? (
        <EditStation
          tenantId={tenantId}
          station={station}
          controlled={{ open: detailsOpen, onOpenChange: setDetailsOpen }}
        />
      ) : null}

      {canSetUp && !showFuel && state.kind === 'ready' ? (
        <NewStationGuide stationName={station.name} />
      ) : null}

      {canSetUp && activeWizard ? (
        <StationWizardPage
          key={JSON.stringify(activeWizard)}
          part={activeWizard}
          stationName={station.name}
          onOpenStaff={staff ? onOpenStaff : undefined}
          onClose={() => {
            setWizard(undefined);
            setMeterHandled(true);
          }}
        />
      ) : null}

      {state.kind === 'loading' ? <LoadingState label="Loading this station" /> : null}
      {state.kind === 'unavailable' ? (
        <AccessDeniedState message="You do not have access to this station's setup." />
      ) : null}
      {state.kind === 'error' ? (
        <ErrorState
          title="This station could not be loaded"
          message="Nothing has been changed. Try again in a moment."
          action={<Button onClick={refresh}>Try again</Button>}
        />
      ) : null}

      {overview && !guiding ? (
        <>
          {openFuel ? (
            <FuelPage
              fuel={openFuel}
              canSetUp={canSetUp}
              onYes={() => setWizard({ kind: 'choose', productId: openFuel.productId })}
              onNo={() => setFuelId(undefined)}
            />
          ) : (
            <>
              <SectionCard
                id="station-fuels"
                title="Fuels"
                action={
                  canSetUp ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-haspopup="dialog"
                      onClick={() => setWizard({ kind: 'addFuel' })}
                    >
                      Add a fuel
                    </Button>
                  ) : null
                }
              >
                {overview.fuels.length === 0 ? (
                  <CardEmpty>No fuel has been added to this station yet.</CardEmpty>
                ) : (
                  <div className={styles.fuelGrid} role="list" aria-label="Fuels">
                    {overview.fuels.map((fuel) => (
                      <div
                        className={`${styles.fuelCard} ${styles.clickable}`}
                        role="listitem"
                        key={fuel.productId}
                        tabIndex={0}
                        aria-label={`Open ${fuel.name}`}
                        onClick={() => setFuelId(fuel.productId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setFuelId(fuel.productId);
                          }
                        }}
                      >
                        <div className={styles.fuelTop}>
                          <span className={styles.name}>{fuel.name}</span>
                          <span className={styles.fuelPrice}>
                            {fuel.price
                              ? (() => {
                                  const p = formatUnitPrice(
                                    fuel.price,
                                    fuel.unitWord === 'litres' ? 'L' : 'kg',
                                  );
                                  return `${p.amount}${p.unit}`;
                                })()
                              : fuel.priceNote}
                          </span>
                        </div>
                        {fuel.unitWord !== 'litres' ? (
                          <span className={styles.muted}>Sold in {fuel.unitWord}</span>
                        ) : null}
                        <div className={styles.fuelPart}>
                          <span className={styles.cellLabel}>Tanks</span>
                          {fuel.tanks.length ? (
                            fuel.tanks.map((tank) => <span key={tank}>{tank}</span>)
                          ) : (
                            <span className={styles.muted}>No tank yet</span>
                          )}
                        </div>
                        <div className={styles.fuelPart}>
                          <span className={styles.cellLabel}>Pumps & Nozzles</span>
                          {fuel.nozzles.length ? (
                            fuel.nozzles.map((nozzle) => <span key={nozzle}>{nozzle}</span>)
                          ) : (
                            <span className={styles.muted}>No nozzle yet</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {canSetUp && hiddenFuels.length > 0 ? (
                  <CardRows label="Hidden fuels">
                    {hiddenFuels.map((fuel) => (
                      <CardRow
                        key={fuel.id}
                        title={fuel.name}
                        detail="Hidden. It is not offered for sale."
                        aside={
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              setWizard({
                                kind: 'fuel',
                                productId: fuel.id,
                                flow: 'visibility',
                              })
                            }
                          >
                            Show again
                          </Button>
                        }
                      />
                    ))}
                  </CardRows>
                ) : null}
              </SectionCard>

              <SectionCard id="station-whole" title="The whole station">
                <CardRows label="The whole station">
                  <CardRow
                    title="Shifts"
                    detail={
                      overview.shifts.length > 0
                        ? overview.shifts.map((shift) => `${shift.name} ${shift.when}`).join(', ')
                        : 'No shift added yet.'
                    }
                    aside={
                      canSetUp ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-haspopup="dialog"
                          aria-label="Change shifts"
                          onClick={() => setWizard({ kind: 'shifts' })}
                        >
                          Change shifts
                        </Button>
                      ) : null
                    }
                  />
                  <CardRow
                    title="Who is in charge"
                    detail={
                      overview.supervisor ??
                      ((shown?.supervisors ?? []).length === 0
                        ? 'No supervisor works at this station yet.'
                        : 'Nobody has been chosen yet.')
                    }
                    aside={
                      canSetUp ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-haspopup="dialog"
                          aria-label="Change who is in charge"
                          onClick={() => setWizard({ kind: 'inCharge' })}
                        >
                          Change
                        </Button>
                      ) : null
                    }
                  />
                  {canSetUp ? (
                    <CardRow
                      title="Opening balances"
                      detail="What the station has today: fuel in the tanks, cash, bank, customers and suppliers."
                      aside={
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-haspopup="dialog"
                          onClick={() => setWizard({ kind: 'openingBalances' })}
                        >
                          Add opening balances
                        </Button>
                      }
                    />
                  ) : null}
                </CardRows>
              </SectionCard>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

/** One fuel on its own page: its price, tanks and nozzles, then a question before anything changes. */
function FuelPage({
  fuel,
  canSetUp,
  onYes,
  onNo,
}: {
  fuel: StationFuelRow;
  canSetUp: boolean;
  /** Opens "What do you want to change?" on its own screen, never beside the tiles. */
  onYes: () => void;
  onNo: () => void;
}) {
  const unit = fuel.unitWord === 'litres' ? 'L' : 'kg';
  const accent = { '--fuel-accent': 'var(--brand, #2f6f5a)' } as CSSProperties;
  return (
    <div className={styles.fuelPage} style={accent}>
      {!fuel.done && fuel.needs ? (
        <p className={styles.fuelNeeds}>Still to do: {fuel.needs}.</p>
      ) : null}

      <div className={styles.fuelPanel}>
        <div className={styles.fuelTiles}>
          <section className={styles.fuelHero}>
            <span className={styles.fuelHeroIcon} aria-hidden="true">
              <Icon name="drop" />
            </span>
            <div className={styles.fuelHeroText}>
              <h2 className={styles.title}>{fuel.name}</h2>
            </div>
            <div className={styles.fuelHeroPrice}>
              {fuel.price ? (
                <>
                  <span className={styles.fuelHeroAmount}>
                    {formatUnitPrice(fuel.price, unit).amount}
                    <span className={styles.fuelHeroUnit}>
                      {formatUnitPrice(fuel.price, unit).unit}
                    </span>
                  </span>
                </>
              ) : (
                <span className={styles.fuelHeroUnit}>{fuel.priceNote}</span>
              )}
            </div>
          </section>
          <section className={styles.fuelTile}>
            <span className={styles.fuelTileIcon} aria-hidden="true">
              <Icon name="tank" />
            </span>
            <h2 className={styles.title}>Tanks</h2>
            <div className={styles.chips}>
              {fuel.tanks.length ? (
                fuel.tanks.map((tank) => (
                  <span key={tank} className={styles.chip}>
                    {tank}
                  </span>
                ))
              ) : (
                <span className={styles.muted}>No tank yet</span>
              )}
            </div>
          </section>
          <section className={styles.fuelTile}>
            <span className={styles.fuelTileIcon} aria-hidden="true">
              <Icon name="nozzle" />
            </span>
            <h2 className={styles.title}>Pumps & Nozzles</h2>
            <div className={styles.chips}>
              {fuel.nozzles.length ? (
                fuel.nozzles.map((nozzle) => (
                  <span key={nozzle} className={styles.chip}>
                    {nozzle}
                  </span>
                ))
              ) : (
                <span className={styles.muted}>No nozzle yet</span>
              )}
            </div>
          </section>
        </div>

        {canSetUp ? (
          <section className={styles.fuelAsk} role="group" aria-label={`Change ${fuel.name}`}>
            <div className={styles.askRow}>
              <strong>Do you want to change anything for {fuel.name}?</strong>
              <div className={styles.actions}>
                <Button onClick={onYes}>Yes, change it</Button>
                <Button variant="secondary" onClick={onNo}>
                  No, leave it
                </Button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
