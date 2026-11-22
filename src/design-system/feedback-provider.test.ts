import { describe, expect, it } from 'vitest';

import {
  OWN_CONFIRMATION_HEADER,
  OWN_ERRORS_HEADER,
  refusalMessage,
  wantsOwnConfirmation,
  wantsOwnErrors,
} from './feedback-provider';

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('refusalMessage', () => {
  it('returns the server wording for a refused or conflicting command', async () => {
    expect(
      await refusalMessage(respond(403, { error: 'FORBIDDEN', message: 'You sent this order.' })),
    ).toBe('You sent this order.');
    expect(
      await refusalMessage(respond(409, { error: 'CONFLICT', message: 'Changed elsewhere.' })),
    ).toBe('Changed elsewhere.');
    expect(await refusalMessage(respond(422, { message: 'The last owner cannot go.' }))).toBe(
      'The last owner cannot go.',
    );
  });

  it('leaves identity checks to their own dialog', async () => {
    expect(
      await refusalMessage(
        respond(403, { error: 'STEP_UP_REQUIRED', message: 'Confirm it is you' }),
      ),
    ).toBeNull();
    expect(await refusalMessage(respond(403, { clerk_error: {}, message: 'x' }))).toBeNull();
  });

  it('ignores other statuses, empty bodies and bodies that are not JSON', async () => {
    expect(await refusalMessage(respond(400, { message: 'Field is wrong' }))).toBe(
      'Field is wrong',
    );
    expect(await refusalMessage(respond(403, {}))).toBeNull();
    expect(await refusalMessage(new Response('nope', { status: 403 }))).toBeNull();
  });

  it('can read the body again afterwards, so the screen still gets it', async () => {
    const response = respond(409, { message: 'Stale' });
    await refusalMessage(response);
    expect(await response.json()).toEqual({ message: 'Stale' });
  });
});

describe('wantsOwnErrors', () => {
  it('is true when the caller sets the opt-out header, however headers are passed', () => {
    expect(wantsOwnErrors('/api/x', { headers: { [OWN_ERRORS_HEADER]: '1' } })).toBe(true);
    expect(wantsOwnErrors('/api/x', { headers: new Headers({ [OWN_ERRORS_HEADER]: '1' }) })).toBe(
      true,
    );
    expect(wantsOwnErrors('/api/x', { headers: [[OWN_ERRORS_HEADER, '1']] })).toBe(true);
  });

  it('is false for an ordinary request, so the global toast keeps working', () => {
    expect(wantsOwnErrors('/api/x', { headers: { 'content-type': 'application/json' } })).toBe(
      false,
    );
    expect(wantsOwnErrors('/api/x')).toBe(false);
  });
});

describe('wantsOwnConfirmation', () => {
  it('is true only when the request carries the header, in any header form', () => {
    expect(wantsOwnConfirmation('/api/x', { headers: { [OWN_CONFIRMATION_HEADER]: '1' } })).toBe(
      true,
    );
    expect(
      wantsOwnConfirmation('/api/x', { headers: new Headers({ [OWN_CONFIRMATION_HEADER]: '1' }) }),
    ).toBe(true);
    expect(wantsOwnConfirmation('/api/x', { headers: [[OWN_CONFIRMATION_HEADER, '1']] })).toBe(
      true,
    );
  });

  it('is false without it, and is not the same as handling your own errors', () => {
    expect(wantsOwnConfirmation('/api/x')).toBe(false);
    expect(
      wantsOwnConfirmation('/api/x', { headers: { 'content-type': 'application/json' } }),
    ).toBe(false);
    expect(wantsOwnConfirmation('/api/x', { headers: { [OWN_ERRORS_HEADER]: '1' } })).toBe(false);
  });
});

describe('refusalMessage: technical wording is never shown raw', () => {
  it('does not echo internal sealed-meter wording as a toast', async () => {
    expect(
      await refusalMessage(
        respond(409, {
          message:
            'Every operated shift requires sealed meter segments and an authoritative terminal meter-close boundary for each participating nozzle',
        }),
      ),
    ).toBeNull();
  });
});
