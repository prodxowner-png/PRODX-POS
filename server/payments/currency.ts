/**
 * Currency minor-unit conversion for provider-facing payment amounts.
 * Database NUMERIC amounts are major currency units; Stripe amounts are integer
 * minor units. Intl's ISO currency metadata supplies the currency exponent.
 */
export const getCurrencyMinorUnitExponent = (currency: string): number | null => {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;

  try {
    const exponent = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalized,
    }).resolvedOptions().maximumFractionDigits;
    return typeof exponent === 'number' && Number.isInteger(exponent) && exponent >= 0 && exponent <= 3
      ? exponent
      : null;
  } catch {
    return null;
  }
};

/** Converts a database major-unit decimal string to provider minor units exactly. */
export const parseMajorAmountToMinorUnits = (value: unknown, currency: string): bigint | null => {
  const exponent = getCurrencyMinorUnitExponent(currency);
  if (exponent === null || typeof value !== 'string') return null;

  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;

  const fraction = match[2] ?? '';
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) return null;

  const scale = 10n ** BigInt(exponent);
  const fractionalMinorUnits = fraction.slice(0, exponent).padEnd(exponent, '0') || '0';
  return BigInt(match[1]) * scale + BigInt(fractionalMinorUnits);
};
