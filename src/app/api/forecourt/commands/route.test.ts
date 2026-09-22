import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { AppError } from '../../../../platform/errors';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  preflight: vi.fn(),
  loadStation: vi.fn(),
  handlers: {
    activatePriceChange: vi.fn(),
    approvePriceChange: vi.fn(),
    approveReconciliation: vi.fn(),
    closeMeters: vi.fn(),
    closeBusinessDay: vi.fn(),
    completeShift: vi.fn(),
    confirmBoundary: vi.fn(),
    correctMeterSegment: vi.fn(),
    createCorrectedReconciliationRevision: vi.fn(),
    createReconciliation: vi.fn(),
    defineShiftTemplate: vi.fn(),
    handoverAttendant: vi.fn(),
    lockBusinessDay: vi.fn(),
    lockReconciliation: vi.fn(),
    markNotOperated: vi.fn(),
    openBusinessDay: vi.fn(),
    postReconciliation: vi.fn(),
    preparePriceActivation: vi.fn(),
    requestPriceChange: vi.fn(),
    replaceMeter: vi.fn(),
    resetMeter: vi.fn(),
    returnReconciliation: vi.fn(),
    sealMeterSegment: vi.fn(),
    startShift: vi.fn(),
    submitReconciliation: vi.fn(),
  },
}));

vi.mock('../../../../modules/identity', () => ({
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../../modules/forecourt/application', () => ({
  authorizeForecourtCommandPreflight: mocks.preflight,
}));

vi.mock('../../../../modules/forecourt/persistence', () => ({
  loadForecourtStation: mocks.loadStation,
}));

vi.mock('../../../../modules/forecourt/commands', () => ({
  activatePriceChangeFromRequest: mocks.handlers.activatePriceChange,
  approvePriceChangeFromRequest: mocks.handlers.approvePriceChange,
  approveReconciliationFromRequest: mocks.handlers.approveReconciliation,
  closeMetersFromRequest: mocks.handlers.closeMeters,
  closeBusinessDayFromRequest: mocks.handlers.closeBusinessDay,
  completeShiftFromRequest: mocks.handlers.completeShift,
  confirmBoundaryFromRequest: mocks.handlers.confirmBoundary,
  correctMeterSegmentFromRequest: mocks.handlers.correctMeterSegment,
  createCorrectedReconciliationRevisionFromRequest:
    mocks.handlers.createCorrectedReconciliationRevision,
  createReconciliationFromRequest: mocks.handlers.createReconciliation,
  defineShiftTemplateFromRequest: mocks.handlers.defineShiftTemplate,
  handoverAttendantFromRequest: mocks.handlers.handoverAttendant,
  lockBusinessDayFromRequest: mocks.handlers.lockBusinessDay,
  lockReconciliationFromRequest: mocks.handlers.lockReconciliation,
  markNotOperatedFromRequest: mocks.handlers.markNotOperated,
  openBusinessDayFromRequest: mocks.handlers.openBusinessDay,
  postReconciliationFromRequest: mocks.handlers.postReconciliation,
  preparePriceActivationFromRequest: mocks.handlers.preparePriceActivation,
  requestPriceChangeFromRequest: mocks.handlers.requestPriceChange,
  replaceMeterFromRequest: mocks.handlers.replaceMeter,
  resetMeterFromRequest: mocks.handlers.resetMeter,
  returnReconciliationFromRequest: mocks.handlers.returnReconciliation,
  sealMeterSegmentFromRequest: mocks.handlers.sealMeterSegment,
  startShiftFromRequest: mocks.handlers.startShift,
  submitReconciliationFromRequest: mocks.handlers.submitReconciliation,
}));

import { POST } from './route';

const authorityBody = {
  commandType: 'OpenBusinessDay',
  tenantId: '11111111-1111-4111-8111-111111111111',
  stationId: '22222222-2222-4222-8222-222222222222',
};

function request(body: unknown): Request {
  return new Request('https://fuel.example.test/api/forecourt/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function malformedCommandError(): ZodError {
  try {
    z.object({
      businessDayId: z.string().uuid(),
      expectedVersion: z.number().int().nonnegative(),
    }).parse({});
  } catch (error) {
    return error as ZodError;
  }
  throw new Error('Expected the test payload to be invalid');
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('POST /api/forecourt/commands security boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue({});
    mocks.preflight.mockResolvedValue({});
    for (const handler of Object.values(mocks.handlers)) handler.mockResolvedValue({ ok: true });
  });

  it('authenticates before parsing an unauthenticated body, including malformed JSON', async () => {
    mocks.authenticate.mockRejectedValue(
      new AppError('UNAUTHENTICATED', 'Authentication is required'),
    );
    const unauthenticatedRequest = new Request('https://fuel.example.test/api/forecourt/commands', {
      method: 'POST',
      body: '{',
    });
    const json = vi.spyOn(unauthenticatedRequest, 'json');

    const response = await POST(unauthenticatedRequest);

    expect(response.status).toBe(401);
    expect(await responseBody(response)).toMatchObject({ error: 'UNAUTHENTICATED' });
    expect(json).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('denies an unauthenticated unknown command before command-type validation', async () => {
    mocks.authenticate.mockRejectedValue(
      new AppError('UNAUTHENTICATED', 'Authentication is required'),
    );
    const unauthenticatedRequest = request({ commandType: 'NotACommand' });
    const json = vi.spyOn(unauthenticatedRequest, 'json');

    const response = await POST(unauthenticatedRequest);

    expect(response.status).toBe(401);
    expect(await responseBody(response)).toMatchObject({ error: 'UNAUTHENTICATED' });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it('preflights tenant/station authority before a detailed command parser', async () => {
    mocks.preflight.mockRejectedValue(
      new AppError('FORBIDDEN', 'The actor is not authorized for this action or scope'),
    );

    const response = await POST(request(authorityBody));
    const body = await responseBody(response);

    expect(response.status).toBe(403);
    expect(body.error).toBe('FORBIDDEN');
    expect(body).not.toHaveProperty('issues');
    expect(body).not.toHaveProperty('details');
    expect(mocks.handlers.openBusinessDay).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('retains detailed validation for an authenticated and authorized command', async () => {
    mocks.handlers.openBusinessDay.mockRejectedValue(malformedCommandError());

    const response = await POST(request(authorityBody));
    const body = await responseBody(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['businessDayId'] })]),
    );
    expect(mocks.preflight).toHaveBeenCalledWith(
      expect.objectContaining({ commandType: 'OpenBusinessDay', body: authorityBody }),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps the unknown-command fallback non-mutating and non-cacheable', async () => {
    const response = await POST(request({ ...authorityBody, commandType: 'NotACommand' }));

    expect(response.status).toBe(400);
    expect(await responseBody(response)).toMatchObject({ error: 'VALIDATION_FAILED' });
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(Object.values(mocks.handlers).every((handler) => !handler.mock.calls.length)).toBe(true);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('adds no-store to success, conflict, validation, forbidden, and internal responses', async () => {
    const success = await POST(request(authorityBody));
    expect(success.status).toBe(200);
    expect(success.headers.get('Cache-Control')).toBe('no-store');

    mocks.handlers.openBusinessDay.mockRejectedValueOnce(new AppError('CONFLICT', 'stale version'));
    const conflict = await POST(request(authorityBody));
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get('Cache-Control')).toBe('no-store');

    mocks.handlers.openBusinessDay.mockRejectedValueOnce(malformedCommandError());
    const validation = await POST(request(authorityBody));
    expect(validation.status).toBe(400);
    expect(validation.headers.get('Cache-Control')).toBe('no-store');

    mocks.preflight.mockRejectedValueOnce(new AppError('FORBIDDEN', 'forbidden'));
    const forbidden = await POST(request(authorityBody));
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('Cache-Control')).toBe('no-store');

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.handlers.openBusinessDay.mockRejectedValueOnce(new Error('unexpected failure'));
    const internal = await POST(request(authorityBody));
    expect(internal.status).toBe(500);
    expect(internal.headers.get('Cache-Control')).toBe('no-store');
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
