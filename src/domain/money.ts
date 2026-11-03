/**
 * PRODX POS Domain - Monetary Invariant Module
 * 
 * CRITICAL ARCHITECTURE RULE:
 * Never use binary floating point for monetary business calculations.
 * All amounts are strictly modeled as integer cents (or minor currency units).
 * Rounding is deterministic and explicitly managed.
 */

export interface Money {
  readonly amountInCents: number;
  readonly currency: string;
}

export const ZERO_USD: Money = Object.freeze({
  amountInCents: 0,
  currency: 'THB',
});

const roundHalfUpDivide = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n;
  const absNum = numerator < 0n ? -numerator : numerator;
  return sign * ((absNum + denominator / 2n) / denominator);
};

/**
 * Exact decimal string/number to integer cents/satang parser using BigInt arithmetic.
 * Never uses binary floating-point multiplication or IEEE-754 approximations.
 */
export function parseDecimalToCents(input: string | number): number {
  const clean = String(input ?? '').replace(/[^0-9.-]/g, '').trim();
  if (!clean || clean === '-' || clean === '.') return 0;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(clean);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1n : 1n;
  const wholeStr = match[2] || '0';
  const fracStr = match[3] || '';
  const centsTwoDigits = (fracStr + '00').slice(0, 2);
  const thirdDigit = fracStr.length >= 3 ? Number(fracStr[2]) : 0;
  let total = BigInt(wholeStr) * 100n + BigInt(centsTwoDigits);
  if (thirdDigit >= 5) {
    total += 1n;
  }
  return Number(sign * total);
}

/**
 * Exact decimal string/number to basis points (1% = 100 bps) parser using BigInt arithmetic.
 */
export function parseDecimalToBps(input: string | number): number {
  return parseDecimalToCents(input);
}

/**
 * Formats integer cents into an exact "0.00" decimal string without floating-point division.
 */
export function centsToDecimalString(amountInCents: number): string {
  const truncated = Math.trunc(Number.isFinite(amountInCents) ? amountInCents : 0);
  const sign = truncated < 0 ? '-' : '';
  const abs = BigInt(Math.abs(truncated));
  const major = abs / 100n;
  const minor = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${major.toString()}.${minor}`;
}

/**
 * Creates a validated Money value object.
 * Enforces integer cents to prevent floating point leakages.
 */
export function createMoney(amountInCents: number, currency = 'THB'): Money {
  if (!Number.isFinite(amountInCents)) {
    throw new TypeError(`[Money] Invalid amount: ${amountInCents}`);
  }
  const sanitized = Number.isInteger(amountInCents) ? amountInCents : Math.trunc(amountInCents);
  return Object.freeze({
    amountInCents: sanitized,
    currency: currency.toUpperCase(),
  });
}

/**
 * Creates Money from a major currency decimal string or number (e.g. "19.99" -> 1999 cents)
 * using exact string-to-BigInt arithmetic.
 */
export function fromDecimal(amount: number | string, currency = 'THB'): Money {
  const cents = parseDecimalToCents(amount);
  return createMoney(cents, currency);
}

/**
 * Adds two Money objects. Enforces currency matching.
 */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`[Money] Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return createMoney(a.amountInCents + b.amountInCents, a.currency);
}

/**
 * Subtracts Money b from Money a.
 */
export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`[Money] Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return createMoney(a.amountInCents - b.amountInCents, a.currency);
}

/**
 * Multiplies Money by an integer or decimal factor (e.g. quantity or discount ratio).
 * Uses half-up deterministic BigInt rounding on minor units.
 */
export function multiplyMoney(m: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new TypeError(`[Money] Invalid multiplication factor: ${factor}`);
  }
  if (Number.isSafeInteger(factor)) {
    return createMoney(Number(BigInt(m.amountInCents) * BigInt(factor)), m.currency);
  }
  const scaledFactor = BigInt(parseDecimalToCents(factor.toFixed(2)));
  const resultCents = Number(roundHalfUpDivide(BigInt(m.amountInCents) * scaledFactor, 100n));
  return createMoney(resultCents, m.currency);
}

/**
 * Calculates percentage discount or tax in basis points (1% = 100 basis points).
 * Example: 8.25% = 825 basis points. Uses exact BigInt half-up division.
 */
export function calculateBasisPoints(m: Money, basisPoints: number): Money {
  const bps = BigInt(Math.trunc(basisPoints));
  const cents = Number(roundHalfUpDivide(BigInt(m.amountInCents) * bps, 10000n));
  return createMoney(cents, m.currency);
}

/**
 * Formats Money for human presentation according to locale rules without binary floating-point division.
 */
export function formatMoney(m: Money, _locale = 'en-US'): string {
  const truncated = Math.trunc(Number.isFinite(m.amountInCents) ? m.amountInCents : 0);
  const sign = truncated < 0 ? '-' : '';
  const abs = BigInt(Math.abs(truncated));
  const major = abs / 100n;
  const minor = (abs % 100n).toString().padStart(2, '0');
  const formattedMajor = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const upper = (m.currency || 'THB').toUpperCase();
  if (upper === 'JPY') {
    return `${sign}¥${formattedMajor}`;
  }
  const symbols: Record<string, string> = {
    THB: '฿',
    USD: '$',
    EUR: '€',
    GBP: '£',
    AUD: 'A$',
  };
  const sym = symbols[upper] ?? `${upper} `;
  return `${sign}${sym}${formattedMajor}.${minor}`;
}

/**
 * Returns raw decimal representation as string (e.g. "19.99") for form inputs.
 */
export function toDecimalString(m: Money): string {
  return centsToDecimalString(m.amountInCents);
}

export type RoundingStrategy = 'exact_cents' | 'round_whole' | 'charm_99' | 'charm_95';

/**
 * Safely applies a percentage increase or decrease to Money.
 * Guarantees pure BigInt integer arithmetic and zero IEEE 754 precision drift.
 */
export function applyPercentageAdjustment(
  base: Money,
  percentage: number,
  direction: 'increase' | 'decrease',
  rounding: RoundingStrategy = 'exact_cents'
): Money {
  if (!Number.isFinite(percentage) || percentage < 0) {
    throw new TypeError(`[Money] Invalid percentage: ${percentage}`);
  }

  const basisPoints = BigInt(parseDecimalToBps(percentage));
  const deltaCents = Number(roundHalfUpDivide(BigInt(base.amountInCents) * basisPoints, 10000n));

  let resultCents = direction === 'increase'
    ? base.amountInCents + deltaCents
    : Math.max(0, base.amountInCents - deltaCents);

  if (rounding === 'round_whole') {
    resultCents = Number(roundHalfUpDivide(BigInt(resultCents), 100n) * 100n);
  } else if (rounding === 'charm_99') {
    if (resultCents > 0) {
      const wholeMajor = Number(BigInt(resultCents) / 100n);
      resultCents = Math.max(99, wholeMajor * 100 + 99);
    }
  } else if (rounding === 'charm_95') {
    if (resultCents > 0) {
      const wholeMajor = Number(BigInt(resultCents) / 100n);
      resultCents = Math.max(95, wholeMajor * 100 + 95);
    }
  }

  return createMoney(Math.max(0, resultCents), base.currency);
}
