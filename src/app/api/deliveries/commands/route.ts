import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  recordDeliveryCompartmentsFromRequest,
  recordDeliveryDriverConfirmationFromRequest,
  recordDeliveryWaterTestFromRequest,
  setWaterTestRequiredFromRequest,
} from '../../../../modules/deliveries';
import { AppError } from '../../../../platform/errors';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

const COMMANDS = [
  'RecordDeliveryCompartments',
  'RecordDeliveryWaterTest',
  'RecordDeliveryDriverConfirmation',
  'SetWaterTestRequired',
] as const;

type CommandType = (typeof COMMANDS)[number];

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      const body: unknown = await request.json();
      const commandType =
        typeof body === 'object' && body !== null && 'commandType' in body
          ? (body as { commandType?: unknown }).commandType
          : undefined;
      if (!COMMANDS.includes(commandType as CommandType)) {
        throw new AppError('VALIDATION_FAILED', 'A supported delivery commandType is required');
      }
      let result: unknown;
      switch (commandType as CommandType) {
        case 'RecordDeliveryCompartments':
          result = await recordDeliveryCompartmentsFromRequest(request, body);
          break;
        case 'RecordDeliveryWaterTest':
          result = await recordDeliveryWaterTestFromRequest(request, body);
          break;
        case 'RecordDeliveryDriverConfirmation':
          result = await recordDeliveryDriverConfirmationFromRequest(request, body);
          break;
        case 'SetWaterTestRequired':
          result = await setWaterTestRequiredFromRequest(request, body);
          break;
      }
      return json(result, 200);
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
