export const requiredAlertIds = [
  'readiness_failure',
  'http_5xx_rate',
  'auth_security_failures',
  'critical_operational_failure',
  'provider_adapter_failure',
] as const;

const severities = new Set(['P0', 'P1', 'P2', 'P3']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasConditionField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasConditionField);
  if (!isRecord(value)) return false;
  if (typeof value.field === 'string') return true;
  return Object.values(value).some(hasConditionField);
}

export function validateObservabilityCatalog(alerts: unknown, dashboard: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(alerts) || alerts.schemaVersion !== 1) {
    errors.push('alerts must declare schemaVersion 1');
  }
  if (!isRecord(dashboard) || dashboard.schemaVersion !== 1) {
    errors.push('dashboard must declare schemaVersion 1');
  }
  if (!isRecord(alerts) || !Array.isArray(alerts.alerts)) {
    errors.push('alerts.alerts must be an array');
  }
  if (!isRecord(dashboard) || !Array.isArray(dashboard.panels)) {
    errors.push('dashboard.panels must be an array');
  }
  if (!isRecord(alerts) || !Array.isArray(alerts.alerts)) return errors;
  if (!isRecord(dashboard) || !Array.isArray(dashboard.panels)) return errors;

  const alertRecords = alerts.alerts.filter(isRecord);
  const alertIds = new Set<string>();
  for (const alert of alertRecords) {
    const id = alert.id;
    if (typeof id !== 'string' || id.length === 0) errors.push('each alert needs a non-empty id');
    else if (alertIds.has(id)) errors.push(`duplicate alert id: ${id}`);
    else alertIds.add(id);
    if (typeof alert.name !== 'string' || alert.name.length === 0) {
      errors.push(`alert ${String(id)} needs a name`);
    }
    if (typeof alert.severity !== 'string' || !severities.has(alert.severity)) {
      errors.push(`alert ${String(id)} needs severity P0-P3`);
    }
    if (typeof alert.window !== 'string' || !/^\d+[smhd]$/.test(alert.window)) {
      errors.push(`alert ${String(id)} needs a duration window`);
    }
    if (!isRecord(alert.threshold) || typeof alert.threshold.operator !== 'string') {
      errors.push(`alert ${String(id)} needs a threshold operator`);
    }
    if (!hasConditionField(alert.condition)) {
      errors.push(`alert ${String(id)} needs at least one field condition`);
    }
    if (typeof alert.notificationPolicy !== 'string' || alert.notificationPolicy.length === 0) {
      errors.push(`alert ${String(id)} needs a notification policy`);
    }
    if (typeof alert.runbook !== 'string' || !alert.runbook.startsWith('docs/runbooks/')) {
      errors.push(`alert ${String(id)} needs a repository runbook reference`);
    }
  }

  for (const id of requiredAlertIds) {
    if (!alertIds.has(id)) errors.push(`missing required alert: ${id}`);
  }

  const panels = dashboard.panels.filter(isRecord);
  const panelIds = new Set<string>();
  for (const panel of panels) {
    const id = panel.id;
    if (typeof id !== 'string' || id.length === 0)
      errors.push('each dashboard panel needs a non-empty id');
    else if (panelIds.has(id)) errors.push(`duplicate dashboard panel id: ${id}`);
    else panelIds.add(id);
    if (typeof panel.title !== 'string' || panel.title.length === 0) {
      errors.push(`panel ${String(id)} needs a title`);
    }
    if (!Array.isArray(panel.alertIds)) errors.push(`panel ${String(id)} needs alertIds`);
    else {
      for (const alertId of panel.alertIds) {
        if (typeof alertId !== 'string' || !alertIds.has(alertId)) {
          errors.push(`panel ${String(id)} references unknown alert ${String(alertId)}`);
        }
      }
    }
  }

  if (isRecord(alerts) && alerts.source !== 'structured-runtime-logs') {
    errors.push('alerts source must be structured-runtime-logs');
  }
  if (isRecord(dashboard) && dashboard.source !== 'structured-runtime-logs') {
    errors.push('dashboard source must be structured-runtime-logs');
  }
  if (isRecord(alerts) && isRecord(dashboard) && alerts.logContract !== dashboard.logContract) {
    errors.push('alerts and dashboard must use the same log contract');
  }

  return errors;
}
