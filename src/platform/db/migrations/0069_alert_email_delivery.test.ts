import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(__dirname, '0069_alert_email_delivery.sql'), 'utf8');

describe('alert email delivery migration', () => {
  it('keeps the recipient capability narrow and role/scope checked', () => {
    expect(migration).toContain('CREATE FUNCTION app.alert_email_recipients');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, app, platform, pg_temp');
    expect(migration).toContain("permission_code = 'report.view'");
    expect(migration).toContain("permission_code = 'station.view'");
    expect(migration).toContain('preference.enabled');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION app.alert_email_recipients(integer) TO app_runtime',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION app.alert_email_recipients(integer) FROM PUBLIC',
    );
  });

  it('has durable tenant-scoped sent state and a concurrent claim key', () => {
    expect(migration).toContain('CREATE TABLE app.alert_email_deliveries');
    expect(migration).toContain('UNIQUE (tenant_id, membership_id, station_id, digest_key)');
    expect(migration).toContain("state IN ('CLAIMED', 'FAILED', 'SENT')");
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE ON app.alert_email_deliveries TO app_runtime',
    );
  });
});
