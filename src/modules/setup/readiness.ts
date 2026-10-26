import type {
  ActivationMissing,
  ReadinessArea,
  ReadinessStatus,
  StationReadiness,
  StationSetupFacts,
} from './contracts';

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Counts are shown only when at least one record exists. */
function pricesArea(facts: StationSetupFacts): ReadinessArea {
  const blocks = 'Selling fuel, opening a shift with meter readings, and revenue recognition';
  if (facts.activeProducts === 0) {
    return {
      code: 'PRICES',
      label: 'Products and prices',
      status: 'NOT_ENTERED',
      detail: 'No fuel products have been entered for the organisation.',
      blocks,
    };
  }
  if (facts.pricedProducts === 0) {
    return {
      code: 'PRICES',
      label: 'Products and prices',
      status: 'NOT_ENTERED',
      detail: 'Prices not entered for this station.',
      blocks,
    };
  }
  if (facts.pricedProducts < facts.activeProducts) {
    return {
      code: 'PRICES',
      label: 'Products and prices',
      status: 'PARTIAL',
      detail: `${facts.pricedProducts} of ${plural(facts.activeProducts, 'product')} priced here; the rest are not entered.`,
      blocks,
    };
  }
  return {
    code: 'PRICES',
    label: 'Products and prices',
    status: 'READY',
    detail: `${plural(facts.activeProducts, 'product')} with an active price.`,
    blocks,
  };
}

function tanksArea(facts: StationSetupFacts): ReadinessArea {
  const blocks = 'Fuel deliveries, tank dips, and stock reconciliation';
  if (facts.activeTanks === 0) {
    return {
      code: 'TANKS',
      label: 'Tanks',
      status: 'NOT_ENTERED',
      detail: 'No tanks have been entered.',
      blocks,
    };
  }
  if (facts.tanksMissingTolerance > 0) {
    return {
      code: 'TANKS',
      label: 'Tanks',
      status: 'PARTIAL',
      detail: `${plural(facts.activeTanks, 'tank')} entered; variance tolerance not entered for ${facts.tanksMissingTolerance}.`,
      blocks,
    };
  }
  if (facts.tanksMissingOpeningStock > 0) {
    return {
      code: 'TANKS',
      label: 'Tanks',
      status: 'PARTIAL',
      detail: `${plural(facts.activeTanks, 'tank')} entered; opening stock not recorded for ${facts.tanksMissingOpeningStock}.`,
      blocks: 'Fuel stock levels and the cost of fuel sold',
    };
  }
  if (facts.tanksMissingOpeningCost > 0) {
    return {
      code: 'TANKS',
      label: 'Tanks',
      status: 'PARTIAL',
      detail: `${plural(facts.activeTanks, 'tank')} entered; opening stock has no cost for ${facts.tanksMissingOpeningCost}.`,
      blocks: 'The cost of fuel sold and stock value',
    };
  }
  return {
    code: 'TANKS',
    label: 'Tanks',
    status: 'READY',
    detail: `${plural(facts.activeTanks, 'tank')} entered with variance tolerance.`,
    blocks,
  };
}

function pumpsArea(facts: StationSetupFacts): ReadinessArea {
  const blocks = 'Meter readings, shift opening and closing, and daily reconciliation';
  if (facts.activePumps === 0) {
    return {
      code: 'PUMPS',
      label: 'Pumps and nozzles',
      status: 'NOT_ENTERED',
      detail: 'No pumps have been entered.',
      blocks,
    };
  }
  if (facts.activeNozzles === 0) {
    return {
      code: 'PUMPS',
      label: 'Pumps and nozzles',
      status: 'NOT_ENTERED',
      detail: 'Nozzles not entered.',
      blocks,
    };
  }
  if (facts.pumpsWithoutNozzle > 0) {
    return {
      code: 'PUMPS',
      label: 'Pumps and nozzles',
      status: 'PARTIAL',
      detail: `${plural(facts.activePumps, 'pump')} entered; ${plural(facts.pumpsWithoutNozzle, 'pump')} without a nozzle.`,
      blocks,
    };
  }
  return {
    code: 'PUMPS',
    label: 'Pumps and nozzles',
    status: 'READY',
    detail: `${plural(facts.activePumps, 'pump')} and ${plural(facts.activeNozzles, 'nozzle')} entered.`,
    blocks,
  };
}

function shiftsArea(facts: StationSetupFacts): ReadinessArea {
  const blocks = 'Opening shifts from a template';
  return facts.activeShiftTemplates === 0
    ? {
        code: 'SHIFTS',
        label: 'Shift templates',
        status: 'NOT_ENTERED',
        detail: 'No shift templates have been entered.',
        blocks,
      }
    : {
        code: 'SHIFTS',
        label: 'Shift templates',
        status: 'READY',
        detail: `${plural(facts.activeShiftTemplates, 'shift template')} entered.`,
        blocks,
      };
}

function paymentsArea(facts: StationSetupFacts): ReadinessArea {
  const blocks = 'Electronic payment settlements and bank deposits';
  const hasProvider = facts.providerAccounts > 0;
  const hasBank = facts.bankAccounts > 0;
  if (!hasProvider && !hasBank) {
    return {
      code: 'PAYMENTS',
      label: 'Payment accounts',
      status: 'NOT_ENTERED',
      detail: 'No payment provider accounts or bank accounts have been entered.',
      blocks,
    };
  }
  if (hasProvider && hasBank) {
    return {
      code: 'PAYMENTS',
      label: 'Payment accounts',
      status: 'READY',
      detail: `${plural(facts.providerAccounts, 'provider account')} and ${plural(facts.bankAccounts, 'bank account')} entered.`,
      blocks,
    };
  }
  return {
    code: 'PAYMENTS',
    label: 'Payment accounts',
    status: 'PARTIAL',
    detail: hasProvider
      ? `${plural(facts.providerAccounts, 'provider account')} entered; bank account not entered.`
      : `${plural(facts.bankAccounts, 'bank account')} entered; provider account not entered.`,
    blocks: hasProvider ? 'Bank deposits' : 'Electronic payment settlements',
  };
}

function staffArea(facts: StationSetupFacts): ReadinessArea {
  const blocks = 'Assigning anyone to work shifts at this station';
  return facts.assignedStaff === 0
    ? {
        code: 'STAFF',
        label: 'Staff assignment',
        status: 'NOT_ENTERED',
        detail: 'No staff are assigned to this station.',
        blocks,
      }
    : {
        code: 'STAFF',
        label: 'Staff assignment',
        status: 'READY',
        detail: `${plural(facts.assignedStaff, 'person', 'people')} assigned to this station.`,
        blocks,
      };
}

/**
 * What must exist before a station can trade. Opening stock, tolerances and payment accounts
 * are entered after go-live, so they do not hold the station back.
 */
export function activationMissing(facts: StationSetupFacts): ActivationMissing[] {
  const missing: ActivationMissing[] = [];
  const prices = pricesArea(facts);
  if (prices.status !== 'READY') {
    missing.push({ code: 'PRICES', label: 'Fuel prices', detail: prices.detail, tab: 'setup' });
  }
  if (facts.activeTanks === 0) {
    missing.push({
      code: 'TANKS',
      label: 'Tanks',
      detail: 'Add at least one tank.',
      tab: 'setup',
    });
  }
  const pumps = pumpsArea(facts);
  if (pumps.status !== 'READY') {
    missing.push({ code: 'PUMPS', label: 'Pumps and nozzles', detail: pumps.detail, tab: 'setup' });
  }
  if (facts.activeShiftTemplates === 0) {
    missing.push({
      code: 'SHIFTS',
      label: 'Shifts',
      detail: 'Add the shifts this station works.',
      tab: 'setup',
    });
  }
  if (facts.assignedStaff === 0) {
    missing.push({
      code: 'STAFF',
      label: 'Staff',
      detail: 'Assign at least one person to this station.',
      tab: 'staff',
    });
  }
  return missing;
}

export function computeStationReadiness(facts: StationSetupFacts): StationReadiness {
  const areas = [
    pricesArea(facts),
    tanksArea(facts),
    pumpsArea(facts),
    shiftsArea(facts),
    paymentsArea(facts),
    staffArea(facts),
  ] as const;
  const open = areas.filter((area) => area.status !== 'READY');
  const blockedSummary =
    open.length === 0
      ? null
      : `Blocked until setup is complete: ${open.map((area) => area.blocks.toLowerCase()).join('; ')}.`;
  const stationStatus = facts.stationStatus ?? 'ACTIVE';
  const missing = activationMissing(facts);
  return {
    stationId: facts.stationId,
    stationCode: facts.stationCode,
    stationName: facts.stationName,
    legalEntityId: facts.legalEntityId,
    stationStatus,
    missing,
    canActivate: stationStatus === 'ONBOARDING' && missing.length === 0,
    areas,
    ready: open.length === 0,
    blockedSummary,
  };
}

export function statusLabel(status: ReadinessStatus): string {
  return status === 'READY' ? 'Ready' : status === 'PARTIAL' ? 'Incomplete' : 'Not entered';
}
