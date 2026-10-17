import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  confirmDeliveryFromRequest,
  createDeliveryFromRequest,
  createTankFromRequest,
  deactivateTankFromRequest,
  approveInventoryCostRevaluationFromRequest,
  postInventoryAdjustmentFromRequest,
  postInventoryCostRevaluationFromRequest,
  recordOpeningInventoryCostFromRequest,
  recordOpeningBalanceFromRequest,
  recordTankCalibrationChartFromRequest,
  recordReceiptCostFromRequest,
  recordTankDipFromRequest,
  requestInventoryCostRevaluationFromRequest,
} from '../../../../modules/inventory';
import { AppError } from '../../../../platform/errors';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

const COMMANDS = [
  'CreateTank',
  'DeactivateTank',
  'RecordTankDip',
  'RecordTankCalibrationChart',
  'CreateDelivery',
  'ConfirmDelivery',
  'PostInventoryAdjustment',
  'RecordOpeningBalance',
  'RecordOpeningInventoryCost',
  'RecordReceiptCost',
  'RequestInventoryCostRevaluation',
  'ApproveInventoryCostRevaluation',
  'PostInventoryCostRevaluation',
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
        case 'RecordTankCalibrationChart':
          result = await recordTankCalibrationChartFromRequest(request, body);
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
        case 'RecordOpeningInventoryCost':
          result = await recordOpeningInventoryCostFromRequest(request, body);
          break;
        case 'RecordReceiptCost':
          result = await recordReceiptCostFromRequest(request, body);
          break;
        case 'RequestInventoryCostRevaluation':
          result = await requestInventoryCostRevaluationFromRequest(request, body);
          break;
        case 'ApproveInventoryCostRevaluation':
          result = await approveInventoryCostRevaluationFromRequest(request, body);
          break;
        case 'PostInventoryCostRevaluation':
          result = await postInventoryCostRevaluationFromRequest(request, body);
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
