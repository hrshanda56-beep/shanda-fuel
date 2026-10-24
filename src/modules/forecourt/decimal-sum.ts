const SCALE = 6;

function toScaled(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return 0n;
  const [, sign, whole = '0', fraction = ''] = match;
  const scaled = BigInt(whole + fraction.slice(0, SCALE).padEnd(SCALE, '0'));
  return sign ? -scaled : scaled;
}

/** Exact decimal sum of numeric strings, usable on the server and in tests (no floats). */
export function sumDecimals(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) total += toScaled(value);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE).replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
