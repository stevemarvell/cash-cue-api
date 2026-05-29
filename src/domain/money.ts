/** Format minor units (pence) as GBP string, e.g. 150 → "£1.50" */
export function formatGBP(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

/** Assert a value is a safe integer (for money validation) */
export function isMinorUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
