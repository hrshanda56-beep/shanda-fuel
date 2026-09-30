import alerts from '../config/observability/alerts.json';
import dashboard from '../config/observability/dashboard.json';
import { validateObservabilityCatalog } from '../src/platform/observability/catalog';

const errors = validateObservabilityCatalog(alerts, dashboard);
if (errors.length > 0) {
  for (const error of errors) console.error(`Observability catalog: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Observability catalog valid: ${alerts.alerts.length} alerts, ${dashboard.panels.length} dashboard panels`,
  );
}
