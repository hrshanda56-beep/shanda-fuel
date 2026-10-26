import { markReadTiming, profileDatabaseRead } from '../../platform/observability/read-timing';
import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError, isAccessRefusal } from '../../platform/errors';
import { assertStepUp } from '../../platform/security';
import { authorize, isPermissionGranted } from '../../platform/security/permissions';
import {
  FORECOURT_COMMAND_POLICY,
  createForecourtCommandContext,
  type ForecourtCommandContext,
  type ForecourtCommandType,
  type ForecourtTransaction,
} from './application';
import { loadForecourtStationInTransaction } from './persistence';
import { deriveBusinessDate } from '../../platform/domain/business-time';
import { projectOperationsStatus } from './operations-status';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { type AuthenticatedActorContext } from '../identity';
import { resolveStationReadAuthority } from '../context/read-authority';

const uuid = z.string().uuid();

export const operationsOverviewQuery = z.object({
  tenantId: uuid,
  stationId: uuid,
  businessDayId: uuid.optional(),
});

type OperationsOverviewInput = z.infer<typeof operationsOverviewQuery>;

const CONTROL_ROOM_COMMANDS = [
  'OpenBusinessDay',
  'CloseBusinessDay',
  'LockBusinessDay',
  'StartShift',
  'CloseMeters',
  'CompleteShift',
] as const satisfies readonly ForecourtCommandType[];

type ActionAvailability = {
  canExecute: boolean;
  permissionGranted: boolean;
  requiresStepUp: boolean;
};

type ControlRoomActions = {
  [Command in (typeof CONTROL_ROOM_COMMANDS)[number]]: ActionAvailability;
};

type BusinessDayRow = {
  id: string;
  date: string;
  state: string;
  version: number | string;
  openedAt: Date | string | null;
  closedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function applyStationTransactionContext(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
): Promise<void> {
  await transaction.execute(sql`
    select
      set_config('app.tenant_id', ${context.authority.transaction.tenantId}, true),
      set_config('app.actor_id', ${context.authority.transaction.actorId}, true),
      set_config('app.membership_id', ${context.authority.transaction.membershipId}, true),
      set_config('app.legal_entity_id', ${context.authority.transaction.legalEntityId ?? ''}, true),
      set_config('app.station_id', ${context.authority.transaction.stationId ?? ''}, true),
      set_config('app.request_id', ${context.authority.transaction.requestId ?? ''}, true)
  `);
}

function hasPermission(
  context: ForecourtCommandContext,
  permissionCode: 'reconciliation.view',
): boolean {
  try {
    authorize({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: context.scope,
    });
    return true;
  } catch (error) {
    if (isAccessRefusal(error)) return false;
    throw error;
  }
}

function actionAvailability(
  context: ForecourtCommandContext,
  commandType: ForecourtCommandType,
): ActionAvailability {
  const policy = FORECOURT_COMMAND_POLICY[commandType];
  const permissionGranted = isPermissionGranted({
    actor: context.authority.authorization,
    permissionCode: policy.permissionCode,
    requestedScope: context.scope,
  });
  if (!permissionGranted) {
    return { canExecute: false, permissionGranted: false, requiresStepUp: false };
  }

  if (policy.assuranceRequirement === 'STEP_UP') {
    try {
      const stepUpAction = 'stepUpAction' in policy ? policy.stepUpAction : undefined;
      assertStepUp(
        context.authority.actor.session,
        1,
        new Date(),
        context.scope.tenantId,
        stepUpAction,
      );
    } catch (error) {
      if (isAccessRefusal(error)) {
        return { canExecute: false, permissionGranted: true, requiresStepUp: true };
      }
      throw error;
    }
  }

  return { canExecute: true, permissionGranted: true, requiresStepUp: false };
}

function loadControlRoomActions(context: ForecourtCommandContext): ControlRoomActions {
  return Object.fromEntries(
    CONTROL_ROOM_COMMANDS.map((commandType) => [
      commandType,
      actionAvailability(context, commandType),
    ]),
  ) as ControlRoomActions;
}

export async function getOperationsOverviewFromRequest(
  request: Request,
  input: OperationsOverviewInput,
  authenticatedActor?: AuthenticatedActorContext,
) {
  const { authority, station: snapshotStation } = await resolveStationReadAuthority({
    request,
    tenantId: input.tenantId,
    stationId: input.stationId,
    ...(authenticatedActor ? { authenticatedActor } : {}),
  });

  markReadTiming('operations.authority.ready');
  const transactionContext = snapshotStation
    ? createTrustedTenantTransactionContext({
        ...authority.transaction,
        legalEntityId: snapshotStation.legalEntityId,
        stationId: snapshotStation.id,
      })
    : authority.transaction;
  return withTenantTransaction(transactionContext, async (transaction) => {
    markReadTiming('operations.transaction.context.ready');
    const station =
      snapshotStation ??
      (await loadForecourtStationInTransaction(transaction, authority, input.stationId));
    if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');

    const context = createForecourtCommandContext({
      authority: {
        ...authority,
        transaction: createTrustedTenantTransactionContext({
          ...authority.transaction,
          legalEntityId: station.legalEntityId,
          stationId: station.id,
        }),
      },
      station,
    });
    markReadTiming('operations.station.loaded');
    if (!snapshotStation) await applyStationTransactionContext(transaction, context);
    markReadTiming('operations.station.context.ready');

    authorize({
      actor: context.authority.authorization,
      permissionCode: 'business_day.view',
      requestedScope: context.scope,
    });
    authorize({
      actor: context.authority.authorization,
      permissionCode: 'shift.view',
      requestedScope: context.scope,
    });

    const canViewReconciliations = hasPermission(context, 'reconciliation.view');
    const actions = loadControlRoomActions(context);

    return loadOperationsOverview(transaction, context, input, {
      actions,
      canViewReconciliations,
    });
  });
}

async function loadOperationsOverview(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  input: OperationsOverviewInput,
  permissions: {
    actions: ControlRoomActions;
    canViewReconciliations: boolean;
  },
) {
  const stationRows = await profileDatabaseRead<{
    id: string;
    code: string;
    name: string;
    timezone: string;
    tenantId: string;
    tenantName: string;
    now: Date | string;
    days: BusinessDayRow[];
  }>(
    transaction,
    sql`
    select s.id, s.code, s.name, s.timezone,
           t.id as "tenantId", t.name as "tenantName", clock_timestamp() as now,
      coalesce((select json_agg(recent_days) from (
        select id, business_date as date, state, version,
          opened_at as "openedAt", closed_at as "closedAt",
          created_at as "createdAt", updated_at as "updatedAt"
        from app.station_business_days
        where tenant_id = s.tenant_id and station_id = s.id
        order by business_date desc limit 30
      ) recent_days), '[]'::json) as days
    from app.stations s
    join app.tenants t on t.id = s.tenant_id
    where s.tenant_id=${context.tenantId} and s.id=${context.stationId}
  `,
  );
  markReadTiming('operations.station.details.loaded');
  const station = stationRows[0];
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');

  const currentBusinessDate = deriveBusinessDate(station.now, station.timezone);

  const days = station.days;
  markReadTiming('operations.business.days.loaded');
  let selectedDay: BusinessDayRow | null;
  if (input.businessDayId) {
    const recentDay = days.find((day) => day.id === input.businessDayId);
    if (recentDay) selectedDay = recentDay;
    else {
      const requestedDayRows = await transaction.execute<BusinessDayRow>(sql`
      select id, business_date as date, state, version,
             opened_at as "openedAt", closed_at as "closedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      from app.station_business_days
      where tenant_id=${context.tenantId}
        and station_id=${context.stationId}
        and id=${input.businessDayId}
      limit 1
    `);
      selectedDay = requestedDayRows[0] ?? null;
      if (!selectedDay) {
        throw new AppError('NOT_FOUND', 'The requested business day was not found');
      }
    }
  } else {
    selectedDay = days.find((day) => day.date === currentBusinessDate) ?? days[0] ?? null;
  }

  if (!selectedDay) {
    return {
      station: {
        id: station.id,
        code: station.code,
        name: station.name,
        timezone: station.timezone,
      },
      organisation: { id: station.tenantId, name: station.tenantName },
      currentBusinessDate,
      currentBusinessDayId: null,
      status: { close: 'NOT_STARTED' as const, approval: 'NO_REVISION' as const },
      businessDays: [],
      shifts: [],
      reconciliations: [],
      visibility: {
        reconciliations: permissions.canViewReconciliations,
      },
      actions: permissions.actions,
    };
  }

  type ShiftRow = {
    id: string;
    state: string;
    businessDate: string;
    plannedStartAt: Date | string;
    plannedEndAt: Date | string;
    version: number | string;
    openedAt: Date | string | null;
    meterClosedAt: Date | string | null;
    completedAt: Date | string | null;
    notOperatedReason: string | null;
    attendantCount: number | string;
  };
  type ReconciliationRow = {
    id: string;
    shiftId: string | null;
    state: string;
    version: number | string;
    createdAt: Date | string;
    updatedAt: Date | string;
    submittedAt: Date | string | null;
    returnedAt: Date | string | null;
    approvedAt: Date | string | null;
    returnReason: string | null;
    revision: number | string | null;
    revisionState: string | null;
  };
  const shiftQuery = sql`
    select s.id, s.state, s.business_date as "businessDate",
           s.planned_start_at as "plannedStartAt", s.planned_end_at as "plannedEndAt",
           s.version, s.opened_at as "openedAt", s.meter_closed_at as "meterClosedAt",
           s.completed_at as "completedAt", s.not_operated_reason as "notOperatedReason",
           count(distinct ra.attendant_id)::int as "attendantCount"
    from app.shifts s
    left join app.reconciliations r
      on r.tenant_id=s.tenant_id and r.station_id=s.station_id and r.shift_id=s.id
    left join app.reconciliation_attendants ra
      on ra.tenant_id=r.tenant_id and ra.station_id=r.station_id and ra.reconciliation_id=r.id
    where s.tenant_id=${context.tenantId} and s.station_id=${context.stationId}
      and s.business_day_id=${selectedDay.id}
    group by s.id
    order by s.planned_start_at, s.id
`;
  const reconciliationQuery = permissions.canViewReconciliations
    ? sql`
    select r.id, r.shift_id as "shiftId", r.state, r.version,
           r.created_at as "createdAt", r.updated_at as "updatedAt",
           r.submitted_at as "submittedAt", r.returned_at as "returnedAt",
           r.approved_at as "approvedAt", r.return_reason as "returnReason",
           latest.revision, latest.state as "revisionState"
    from app.reconciliations r
    left join lateral (
      select revision, state
      from app.reconciliation_revisions revision_row
      where revision_row.tenant_id=r.tenant_id
        and revision_row.station_id=r.station_id
        and revision_row.reconciliation_id=r.id
      order by revision desc, id desc
      limit 1
    ) latest on true
    where r.tenant_id=${context.tenantId} and r.station_id=${context.stationId}
      and r.business_day_id=${selectedDay.id}
    order by r.updated_at desc, r.id
`
    : sql`select null as unavailable where false`;
  const sections = await profileDatabaseRead<{
    shifts: ShiftRow[];
    reconciliations: ReconciliationRow[];
    shiftTemplates?: Array<{
      id: string;
      name: string;
      startTime: string | null;
      durationMinutes: number | string;
    }>;
  }>(
    transaction,
    sql`
    with shift_rows as (${shiftQuery}), reconciliation_rows as (${reconciliationQuery}),
      shift_template_rows as (
        select t.id, t.name, t.start_time::text as "startTime", t.duration_minutes as "durationMinutes"
        from app.shift_templates t
        where t.tenant_id=${context.tenantId} and t.station_id=${context.stationId} and t.active
        order by t.start_time nulls last, t.code
      )
    select coalesce((select json_agg(shift_rows) from shift_rows), '[]'::json) as shifts,
      coalesce((select json_agg(reconciliation_rows) from reconciliation_rows), '[]'::json) as reconciliations,
      coalesce((select json_agg(shift_template_rows) from shift_template_rows), '[]'::json) as "shiftTemplates"
  `,
  );
  const section = sections[0];
  if (!section) throw new AppError('INVARIANT_VIOLATION', 'Operations sections were not returned');
  const { shifts, reconciliations } = section;
  /** Active shift templates, so the screen can offer a first shift when none is planned yet. */
  const shiftTemplates = (section.shiftTemplates ?? []).map((template) => ({
    id: template.id,
    name: template.name,
    startTime: template.startTime ? template.startTime.slice(0, 5) : null,
    durationMinutes: Number(template.durationMinutes),
  }));
  markReadTiming('operations.shifts.loaded');
  markReadTiming('operations.reconciliations.loaded');

  return {
    station: { id: station.id, code: station.code, name: station.name, timezone: station.timezone },
    organisation: { id: station.tenantId, name: station.tenantName },
    currentBusinessDate,
    currentBusinessDayId: days.find((day) => day.date === currentBusinessDate)?.id ?? null,
    status: projectOperationsStatus({
      businessDayState: selectedDay.state,
      shiftStates: shifts.map((shift) => shift.state),
      reconciliationStates: reconciliations.map((item) => item.state),
      revisionStates: reconciliations.flatMap((item) =>
        item.revisionState ? [item.revisionState] : [],
      ),
    }),
    visibility: {
      reconciliations: permissions.canViewReconciliations,
    },
    actions: permissions.actions,
    businessDays: days.map((day) => ({
      id: day.id,
      date: day.date,
      state: day.state,
      version: Number(day.version),
      openedAt: iso(day.openedAt),
      closedAt: iso(day.closedAt),
      updatedAt: iso(day.updatedAt),
    })),
    selectedBusinessDay: {
      id: selectedDay.id,
      date: selectedDay.date,
      state: selectedDay.state,
      version: Number(selectedDay.version),
      openedAt: iso(selectedDay.openedAt),
      closedAt: iso(selectedDay.closedAt),
    },
    shifts: shifts.map((shift) => ({
      id: shift.id,
      state: shift.state,
      businessDate: shift.businessDate,
      plannedStartAt: iso(shift.plannedStartAt),
      plannedEndAt: iso(shift.plannedEndAt),
      version: Number(shift.version),
      openedAt: iso(shift.openedAt),
      meterClosedAt: iso(shift.meterClosedAt),
      completedAt: iso(shift.completedAt),
      notOperatedReason: shift.notOperatedReason,
      attendantCount: Number(shift.attendantCount),
    })),
    shiftTemplates,
    reconciliations: reconciliations.map((item) => ({
      id: item.id,
      shiftId: item.shiftId,
      state: item.state,
      version: Number(item.version),
      revision: item.revision === null ? null : Number(item.revision),
      revisionState: item.revisionState,
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
      submittedAt: iso(item.submittedAt),
      returnedAt: iso(item.returnedAt),
      approvedAt: iso(item.approvedAt),
      returnReason: item.returnReason,
    })),
  };
}
