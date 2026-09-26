import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { assertStepUp } from '../../platform/security';
import { authorize } from '../../platform/security/permissions';
import {
  FORECOURT_COMMAND_POLICY,
  resolveForecourtCommandContext,
  type ForecourtCommandContext,
  type ForecourtCommandType,
  type ForecourtTransaction,
} from './application';
import { loadForecourtStation } from './persistence';
import { deriveBusinessDate } from '../../platform/domain/business-time';

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

type TimelineRow = {
  eventCode: string;
  occurredAt: Date | string;
  actorName: string | null;
  membershipId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  reason: string | null;
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

async function resolveContext(
  request: Request,
  input: OperationsOverviewInput,
): Promise<ForecourtCommandContext> {
  return resolveForecourtCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
    loadStation: loadForecourtStation,
  });
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function hasPermission(
  context: ForecourtCommandContext,
  permissionCode: 'audit.view' | 'reconciliation.view',
): boolean {
  try {
    authorize({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: context.scope,
    });
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORBIDDEN') return false;
    throw error;
  }
}

function actionAvailability(
  context: ForecourtCommandContext,
  commandType: ForecourtCommandType,
): ActionAvailability {
  const policy = FORECOURT_COMMAND_POLICY[commandType];
  try {
    authorize({
      actor: context.authority.authorization,
      permissionCode: policy.permissionCode,
      requestedScope: context.scope,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORBIDDEN') {
      return { canExecute: false, permissionGranted: false, requiresStepUp: false };
    }
    throw error;
  }

  if (policy.assuranceRequirement === 'STEP_UP') {
    try {
      assertStepUp(context.authority.actor.session, 1);
    } catch (error) {
      if (error instanceof AppError && error.code === 'FORBIDDEN') {
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
) {
  const context = await resolveContext(request, input);
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
  const canViewAudit = hasPermission(context, 'audit.view');
  const actions = loadControlRoomActions(context);

  return withTenantTransaction(context.authority.transaction, (transaction) =>
    loadOperationsOverview(transaction, context, input, {
      actions,
      canViewAudit,
      canViewReconciliations,
    }),
  );
}

async function loadOperationsOverview(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  input: OperationsOverviewInput,
  permissions: {
    actions: ControlRoomActions;
    canViewAudit: boolean;
    canViewReconciliations: boolean;
  },
) {
  const stationRows = await transaction.execute<{
    id: string;
    code: string;
    name: string;
    timezone: string;
    tenantId: string;
    tenantName: string;
  }>(sql`
    select s.id, s.code, s.name, s.timezone,
           t.id as "tenantId", t.name as "tenantName"
    from app.stations s
    join app.tenants t on t.id = s.tenant_id
    where s.tenant_id=${context.tenantId} and s.id=${context.stationId}
  `);
  const station = stationRows[0];
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');

  const nowRows = await transaction.execute<{ now: Date | string }>(
    sql`select clock_timestamp() as now`,
  );
  const currentBusinessDate = deriveBusinessDate(nowRows[0]?.now ?? new Date(), station.timezone);

  const days = await transaction.execute<BusinessDayRow>(sql`
    select id, business_date as date, state, version,
           opened_at as "openedAt", closed_at as "closedAt",
           created_at as "createdAt", updated_at as "updatedAt"
    from app.station_business_days
    where tenant_id=${context.tenantId} and station_id=${context.stationId}
    order by business_date desc
    limit 30
  `);

  let selectedDay: BusinessDayRow | null;
  if (input.businessDayId) {
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
      businessDays: [],
      shifts: [],
      reconciliations: [],
      timeline: [],
      visibility: {
        reconciliations: permissions.canViewReconciliations,
        auditTimeline: permissions.canViewAudit,
      },
      actions: permissions.actions,
    };
  }

  const shifts = await transaction.execute<{
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
  }>(sql`
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
  `);

  const reconciliations = permissions.canViewReconciliations
    ? await transaction.execute<{
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
      }>(sql`
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
  `)
    : [];

  const subjectIds = [
    selectedDay.id,
    ...shifts.map((shift) => shift.id),
    ...reconciliations.map((item) => item.id),
  ];
  const subjectIdsFilter = sql.join(
    subjectIds.map((subjectId) => sql`${subjectId}`),
    sql`, `,
  );
  const shiftTimelineFilter = shifts.length
    ? sql`or e.details->'metadata'->>'shiftId' in (${sql.join(
        shifts.map((shift) => sql`${shift.id}`),
        sql`, `,
      )})`
    : sql``;
  const reconciliationTimelineFilter = reconciliations.length
    ? sql`or e.details->'metadata'->>'reconciliationId' in (${sql.join(
        reconciliations.map((item) => sql`${item.id}`),
        sql`, `,
      )})`
    : sql``;
  const timeline =
    permissions.canViewAudit && subjectIds.length
      ? await transaction.execute<TimelineRow>(sql`
        select e.event_code as "eventCode", e.occurred_at as "occurredAt",
               coalesce(u.name, e.actor_id::text) as "actorName",
               e.membership_id as "membershipId",
               e.details->>'subjectType' as "subjectType",
               e.details->>'subjectId' as "subjectId",
               e.details->>'reason' as reason
        from platform.security_events e
        left join auth."user" u on u.id=e.actor_id
        where e.tenant_id=${context.tenantId}
          and (
            e.details->>'subjectId' in (${subjectIdsFilter})
            or e.details->'metadata'->>'businessDayId' = ${selectedDay.id}
            ${shiftTimelineFilter}
            ${reconciliationTimelineFilter}
          )
        order by e.occurred_at desc
        limit 100
      `)
      : [];

  return {
    station: { id: station.id, code: station.code, name: station.name, timezone: station.timezone },
    organisation: { id: station.tenantId, name: station.tenantName },
    currentBusinessDate,
    currentBusinessDayId: days.find((day) => day.date === currentBusinessDate)?.id ?? null,
    visibility: {
      reconciliations: permissions.canViewReconciliations,
      auditTimeline: permissions.canViewAudit,
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
    timeline: timeline.map((item) => ({
      eventCode: item.eventCode,
      occurredAt: iso(item.occurredAt),
      actorName: item.actorName,
      membershipId: item.membershipId,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      reason: item.reason,
    })),
  };
}
