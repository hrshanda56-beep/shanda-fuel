import { describe, expect, it } from 'vitest';

import {
  OWNER_BOOTSTRAP_DISPLAY_NAME,
  OWNER_BOOTSTRAP_EMAIL,
  OWNER_BOOTSTRAP_LEGAL_ENTITY_ID,
  OWNER_BOOTSTRAP_STATION_IDS,
  OWNER_BOOTSTRAP_TENANT_ID,
  parseCli,
} from '../../../scripts/first-owner-provisioning';

describe('first production OWNER provisioning helper', () => {
  it('has one fixed identity and exactly four fixed stations', () => {
    expect(OWNER_BOOTSTRAP_DISPLAY_NAME).toBe('Shanda Admin');
    expect(OWNER_BOOTSTRAP_EMAIL).toBe('hrshanda56@gmail.com');
    expect(OWNER_BOOTSTRAP_TENANT_ID).toBe('a8852b9f-c490-4a72-a3f3-8662aeb14a8a');
    expect(OWNER_BOOTSTRAP_LEGAL_ENTITY_ID).toBe('cb5789ea-0979-450e-83d1-9834135cbedf');
    expect(OWNER_BOOTSTRAP_STATION_IDS).toEqual([
      'd8913b4d-7bb8-48cb-bb46-a741cea1f6c5',
      'c4954604-2bcb-4e59-96e9-12e35449545c',
      'ae3bf2a5-7ff0-42a3-832c-ae8f49a14b9f',
      '68ef219f-6baa-442a-8465-6d52e505d1f3',
    ]);
  });

  it('requires explicit production confirmation and rejects override inputs', () => {
    expect(
      parseCli(['--dry-run', '--environment', 'production', '--confirm-production-provisioning']),
    ).toEqual({ mode: 'dry-run', environment: 'production', confirmed: true });
    expect(() => parseCli(['--provision', '--environment', 'production'])).toThrow(
      'confirm-production-provisioning',
    );
    expect(() =>
      parseCli([
        '--provision',
        '--environment',
        'production',
        '--confirm-production-provisioning',
        '--role',
        'ADMINISTRATOR',
      ]),
    ).toThrow('Unknown OWNER bootstrap option');
    expect(() =>
      parseCli([
        '--provision',
        '--environment',
        'production',
        '--confirm-production-provisioning',
        '--tenant-id',
        '11111111-1111-4111-8111-111111111111',
      ]),
    ).toThrow('Unknown OWNER bootstrap option');
  });
});
