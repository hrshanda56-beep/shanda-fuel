import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { getAuditSigningKey } from '../../platform/config/env';
import { appendSecurityEvent } from '../audit/contracts';
import {
  assertPeriodWithinTemplate,
  dailyRecognitionSchedule,
  monthPeriod,
  recognitionAmountForDate,
} from './domain';

type JobWork = Readonly<{
  tenant_id: string;
  legal_entity_id: string;
  station_id: string | null;
  template_id: string;
  period_start: string;
  recognition_date: string;
  membership_id: string;
  identity_id: string;
}>;

type JobResult = Readonly<{
  templates: number;
  periodsCreated: number;
  recognitionsCreated: number;
  alreadyComplete: number;
  failed: number;
}>;

const WORK_LIMIT = 500;

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Inclusive dates used by the scheduler; exported for focused exact-date tests. */
export function recognitionDatesThrough(start: string, through: string): string[] {
  if (start > through) return [];
  const dates: string[] = [];
  for (let offset = 0; ; offset += 1) {
    const date = addDays(start, offset);
    if (date > through) return dates;
    dates.push(date);
  }
}

async function applyWork(
  work: JobWork,
): Promise<{ periodsCreated: number; recognitionsCreated: number }> {
  const context = createTrustedTenantTransactionContext({
    tenantId: work.tenant_id,
    actorId: work.identity_id,
    membershipId: work.membership_id,
    legalEntityId: work.legal_entity_id,
    ...(work.station_id ? { stationId: work.station_id } : {}),
    requestId: randomUUID(),
  });
  const requestId = context.requestId ?? randomUUID();
  return withTenantTransaction(context, async (transaction) => {
    const templates = await transaction.execute<{
      category_id: string;
      amount: string;
      start_date: string;
      end_date: string | null;
      status: string;
    }>(sql`
      select category_id, amount::text as amount, start_date, end_date, status
      from app.recurring_cost_templates
      where tenant_id = ${work.tenant_id}
        and legal_entity_id = ${work.legal_entity_id}
        and station_id is not distinct from ${work.station_id}
        and id = ${work.template_id}
      for share
    `);
    const template = templates[0];
    if (!template || template.status !== 'ACTIVE')
      return { periodsCreated: 0, recognitionsCreated: 0 };

    const period = monthPeriod(work.period_start);
    assertPeriodWithinTemplate(period, {
      startDate: template.start_date,
      endDate: template.end_date,
    });
    const createdPeriod = await transaction.execute<{ id: string }>(sql`
      insert into app.recurring_cost_periods (
        id, tenant_id, legal_entity_id, station_id, template_id, category_id, period_start,
        period_end, currency, amount, generated_by
      ) values (
        ${randomUUID()}, ${work.tenant_id}, ${work.legal_entity_id}, ${work.station_id},
        ${work.template_id}, ${template.category_id}, ${period.start}, ${period.end}, 'USD',
        ${template.amount}, ${work.membership_id}
      )
      on conflict (tenant_id, template_id, period_start) do nothing
      returning id
    `);
    const periodRows = await transaction.execute<{
      id: string;
      category_id: string;
      amount: string;
      period_start: string;
      period_end: string;
    }>(sql`
      select id, category_id, amount::text as amount, period_start, period_end
      from app.recurring_cost_periods
      where tenant_id = ${work.tenant_id} and template_id = ${work.template_id}
        and period_start = ${period.start}
      for update
    `);
    const persistedPeriod = periodRows[0];
    if (!persistedPeriod) throw new Error('The recurring-cost period could not be loaded');
    if (createdPeriod.length > 0) {
      await appendSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId: work.tenant_id,
          membershipId: work.membership_id,
          actorId: work.identity_id,
          actorType: 'SYSTEM',
          actionCode: 'EXPENSE.RECURRING_PERIOD_AUTO_GENERATED',
          subjectType: 'RecurringCostPeriod',
          subjectId: persistedPeriod.id,
          requestId,
          occurredAt: new Date().toISOString(),
          after: {
            templateId: work.template_id,
            periodStart: period.start,
            amount: template.amount,
            stationId: work.station_id,
          },
          metadata: { source: 'scheduled_recurring_costs', legalEntityId: work.legal_entity_id },
        },
        getAuditSigningKey(),
        transaction,
      );
    }

    let recognitionsCreated = 0;
    for (const recognitionDate of recognitionDatesThrough(period.start, work.recognition_date)) {
      const existing = await transaction.execute<{ state: string }>(sql`
        select state
        from app.recurring_cost_recognitions
        where tenant_id = ${work.tenant_id} and period_id = ${persistedPeriod.id}
          and recognition_date = ${recognitionDate}
        for update
      `);
      // A reversal/correction is a deliberate human fact. The automatic job never recreates it.
      if (existing.length > 0) continue;
      const amount = recognitionAmountForDate(
        persistedPeriod.amount,
        monthPeriod(persistedPeriod.period_start),
        recognitionDate,
      );
      const recognition = await transaction.execute<{ id: string }>(sql`
        insert into app.recurring_cost_recognitions (
          id, tenant_id, legal_entity_id, station_id, period_id, recognition_date, currency,
          amount, state, recognized_by
        ) values (
          ${randomUUID()}, ${work.tenant_id}, ${work.legal_entity_id}, ${work.station_id},
          ${persistedPeriod.id}, ${recognitionDate}, 'USD', ${amount}, 'RECOGNIZED',
          ${work.membership_id}
        )
        on conflict do nothing
        returning id
      `);
      if (recognition.length === 0) continue;
      const recognitionId = recognition[0]!.id;
      await transaction.execute(sql`
        insert into app.expense_recognition_movements (
          id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
          source_type, source_id, recognition_date, currency, amount, actor_membership_id
        ) values (
          ${randomUUID()}, ${work.tenant_id}, ${work.legal_entity_id}, ${work.station_id},
          ${persistedPeriod.category_id}, 'FIXED_COST', 'RECOGNITION',
          'RECURRING_COST_RECOGNITION', ${recognitionId}, ${recognitionDate}, 'USD', ${amount},
          ${work.membership_id}
        )
      `);
      await appendSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId: work.tenant_id,
          membershipId: work.membership_id,
          actorId: work.identity_id,
          actorType: 'SYSTEM',
          actionCode: 'EXPENSE.RECURRING_AUTO_RECOGNIZED',
          subjectType: 'RecurringCostRecognition',
          subjectId: recognitionId,
          requestId,
          occurredAt: new Date().toISOString(),
          after: {
            periodId: persistedPeriod.id,
            recognitionDate,
            amount,
            stationId: work.station_id,
          },
          metadata: { source: 'scheduled_recurring_costs', legalEntityId: work.legal_entity_id },
        },
        getAuditSigningKey(),
        transaction,
      );
      recognitionsCreated += 1;
    }
    return {
      periodsCreated: createdPeriod.length,
      recognitionsCreated,
    };
  });
}

export async function runAutomaticRecurringCostRecognition(): Promise<JobResult> {
  const work = await getDatabase().execute<JobWork>(sql`
    select * from app.recurring_cost_job_work(${WORK_LIMIT})
  `);
  let periodsCreated = 0;
  let recognitionsCreated = 0;
  let alreadyComplete = 0;
  let failed = 0;
  for (const item of work) {
    try {
      const result = await applyWork(item);
      periodsCreated += result.periodsCreated;
      recognitionsCreated += result.recognitionsCreated;
      if (result.periodsCreated === 0 && result.recognitionsCreated === 0) alreadyComplete += 1;
    } catch {
      // A later run retries only this template. Do not expose tenant or accounting details in logs.
      failed += 1;
    }
  }
  return {
    templates: work.length,
    periodsCreated,
    recognitionsCreated,
    alreadyComplete,
    failed,
  };
}

export { dailyRecognitionSchedule };
