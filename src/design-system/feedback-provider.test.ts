import { describe, expect, it } from 'vitest';

import { refusalMessage } from './feedback-provider';

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
