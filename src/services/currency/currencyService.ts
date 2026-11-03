/**
 * PRODX POS - Currency Service
 * Manages currency conversion, locale-specific formatting, symbols, and offline exchange rates.
 */

import { Money, createMoney, formatMoney } from '../../domain/money';

export interface CurrencyConfig {
  code: string;
  symbol: string;
  flag: string;
  label: string;
  locale: string;
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: 'THB', symbol: '฿', flag: '🇹🇭', label: 'Thai Baht', locale: 'th-TH' },
  { code: 'USD', symbol: '$', flag: '🇺🇸', label: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', flag: '🇪🇺', label: 'Euro', locale: 'de-DE' },
  { code: 'JPY', symbol: '¥', flag: '🇯🇵', label: 'Japanese Yen', locale: 'ja-JP' },
  { code: 'GBP', symbol: '£', flag: '🇬🇧', label: 'Great British Pound', locale: 'en-GB' },
  { code: 'AUD', symbol: 'A$', flag: '🇦🇺', label: 'Australian Dollar', locale: 'en-AU' },
];

export interface ExchangeRates {
  [currencyCode: string]: number;
}

// Sensible standard defaults relative to 1 THB (as THB is the base default)
const DEFAULT_RATES_REL_THB: ExchangeRates = {
  THB: 1.0,
  USD: 0.029,
  EUR: 0.026,
  JPY: 4.25,
  GBP: 0.022,
  AUD: 0.043,
};

export class CurrencyService {
  private static STORAGE_KEY_RATES = 'prodx_exchange_rates_config';
  private static STORAGE_KEY_BASE = 'prodx_base_currency';

  /**
   * Retrieves the saved base currency (default: THB)
   */
  public static getBaseCurrency(): string {
    return localStorage.getItem(this.STORAGE_KEY_BASE) || 'THB';
  }

  /**
   * Saves the primary base currency
   */
  public static setBaseCurrency(currencyCode: string): void {
    localStorage.setItem(this.STORAGE_KEY_BASE, currencyCode.toUpperCase());
  }

  /**
   * Retrieves exchange rates relative to the base currency.
   * If none are saved, loads sensible initial defaults.
   */
  public static getExchangeRates(baseCurrency: string): ExchangeRates {
    const saved = localStorage.getItem(`${this.STORAGE_KEY_RATES}_${baseCurrency}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback to defaults
      }
    }

    // Generate relative rates if base is different from THB
    const rates: ExchangeRates = {};
    const baseToThbRate = 1 / (DEFAULT_RATES_REL_THB[baseCurrency] || 1);

    for (const cur of SUPPORTED_CURRENCIES) {
      if (cur.code === baseCurrency) {
        rates[cur.code] = 1.0;
      } else {
        // rate = (THB -> Target) / (THB -> Base)
        const thbToTarget = DEFAULT_RATES_REL_THB[cur.code] || 1.0;
        rates[cur.code] = Number((thbToTarget * baseToThbRate).toFixed(5));
      }
    }
    return rates;
  }

  /**
   * Saves custom exchange rates for a specific base currency
   */
  public static saveExchangeRates(baseCurrency: string, rates: ExchangeRates): void {
    localStorage.setItem(`${this.STORAGE_KEY_RATES}_${baseCurrency}`, JSON.stringify(rates));
  }

  /**
   * Formats a Money structure based on its currency rules and locale standards
   */
  public static format(m: Money, forceLocale?: string): string {
    return formatMoney(m, forceLocale);
  }

  /**
   * Converts a Money amount from one currency to another using scaled BigInt arithmetic
   */
  public static convert(m: Money, targetCurrency: string, rates: ExchangeRates): Money {
    const fromCode = (m.currency || 'THB').toUpperCase();
    const toCode = targetCurrency.toUpperCase();

    if (fromCode === toCode) return m;

    const rateToTarget = rates[toCode] || 1.0;
    const rateFromSource = rates[fromCode] || 1.0;

    const scaledTarget = BigInt(Math.max(1, Math.trunc(rateToTarget * 100000)));
    const scaledSource = BigInt(Math.max(1, Math.trunc(rateFromSource * 100000)));
    const convertedCents = Number(
      (BigInt(m.amountInCents) * scaledTarget + scaledSource / 2n) / scaledSource
    );

    return createMoney(convertedCents, toCode);
  }
}
