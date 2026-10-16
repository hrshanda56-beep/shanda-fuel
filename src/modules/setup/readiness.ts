import type {
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
  if (facts.activeTanksWithInactiveProduct > 0) {
    return {
      code: 'TANKS',
      label: 'Tanks',
      status: 'PARTIAL',
      detail: `${plural(facts.activeTanksWithInactiveProduct, 'active tank')} references an inactive or missing fuel product.`,
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
  if (facts.nozzlesWithoutMeter > 0) {
    return {
      code: 'PUMPS',
      label: 'Pumps and nozzles',
      status: 'PARTIAL',
      detail: `${plural(facts.nozzlesWithoutMeter, 'nozzle')} without a current active meter installation.`,
      blocks,
    };
  }
  if (facts.activeNozzlesWithInactiveProduct > 0) {
    return {
      code: 'PUMPS',
      label: 'Pumps and nozzles',
      status: 'PARTIAL',
      detail: `${plural(facts.activeNozzlesWithInactiveProduct, 'active nozzle')} references an inactive or missing fuel product.`,
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
  return {
    stationId: facts.stationId,
    stationCode: facts.stationCode,
    stationName: facts.stationName,
    legalEntityId: facts.legalEntityId,
    areas,
    ready: open.length === 0,
    blockedSummary,
  };
}

export function statusLabel(status: ReadinessStatus): string {
  return status === 'READY' ? 'Ready' : status === 'PARTIAL' ? 'Incomplete' : 'Not entered';
}
