import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  confirmDeliveryFromRequest,
  createDeliveryFromRequest,
  createTankFromRequest,
  deactivateTankFromRequest,
  postInventoryAdjustmentFromRequest,
  recordOpeningBalanceFromRequest,
  recordTankDipFromRequest,
} from '../../../../modules/inventory';
import { AppError } from '../../../../platform/errors';

const COMMANDS = [
  'CreateTank',
  'DeactivateTank',
  'RecordTankDip',
  'CreateDelivery',
  'ConfirmDelivery',
  'PostInventoryAdjustment',
  'RecordOpeningBalance',
] as const;

type CommandType = (typeof COMMANDS)[number];

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuthenticatedActor(request);
    const body: unknown = await request.json();
    const commandType =
      typeof body === 'object' && body !== null && 'commandType' in body
        ? (body as { commandType?: unknown }).commandType
        : undefined;
    if (!COMMANDS.includes(commandType as CommandType)) {
      throw new AppError('VALIDATION_FAILED', 'A supported inventory commandType is required');
    }
    let result: unknown;
    switch (commandType as CommandType) {
      case 'CreateTank':
        result = await createTankFromRequest(request, body);
        break;
      case 'DeactivateTank':
        result = await deactivateTankFromRequest(request, body);
        break;
      case 'RecordTankDip':
        result = await recordTankDipFromRequest(request, body);
        break;
      case 'CreateDelivery':
        result = await createDeliveryFromRequest(request, body);
        break;
      case 'ConfirmDelivery':
        result = await confirmDeliveryFromRequest(request, body);
        break;
      case 'PostInventoryAdjustment':
        result = await postInventoryAdjustmentFromRequest(request, body);
        break;
      case 'RecordOpeningBalance':
        result = await recordOpeningBalanceFromRequest(request, body);
        break;
    }
    return json(result, 200);
  } catch (error) {
    if (error instanceof ZodError)
      return json({ error: 'VALIDATION_FAILED', issues: error.issues }, 400);
    if (error instanceof AppError)
      return json(
        { error: error.code, message: error.message, details: error.details },
        error.httpStatus,
      );
    console.error('inventory command failed', error);
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
}
