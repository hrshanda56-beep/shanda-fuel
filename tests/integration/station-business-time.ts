function localDateTimeParts(
  businessDate: string,
  localTime: { hour: number; minute: number; second: number },
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) throw new Error(`Invalid business date: ${businessDate}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    ...localTime,
  };
}

/** Convert a station-local wall-clock time to an instant using its IANA zone. */
export function stationLocalInstant(
  businessDate: string,
  timeZone: string,
  localTime: { hour: number; minute?: number; second?: number },
): string {
  const requested = localDateTimeParts(businessDate, {
    hour: localTime.hour,
    minute: localTime.minute ?? 0,
    second: localTime.second ?? 0,
  });
  const requestedAsUtc = Date.UTC(
    requested.year,
    requested.month - 1,
    requested.day,
    requested.hour,
    requested.minute,
    requested.second,
  );
  let instant = requestedAsUtc;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  // Correct the UTC guess by the station's actual offset. A second pass makes
  // this work across offset transitions without relying on the process TZ.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
    );
    const observedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const correction = requestedAsUtc - observedAsUtc;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant).toISOString();
}

export function stationBusinessDayBounds(
  businessDate: string,
  timeZone: string,
): { plannedStartAt: string; plannedEndAt: string } {
  return {
    plannedStartAt: stationLocalInstant(businessDate, timeZone, { hour: 0 }),
    plannedEndAt: stationLocalInstant(businessDate, timeZone, {
      hour: 23,
      minute: 59,
      second: 59,
    }),
  };
}
