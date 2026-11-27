import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ProductCard } from './ProductCard';
import { LanguageProvider } from '../../context/LanguageContext';
import { readFileSync } from 'node:fs';
import type { Product } from '../../domain/catalog';

const sampleInStockProduct: Product = {
  id: 'prod-latte-01',
  storeId: 'store-01',
  sku: 'COF-LAT-001',
  name: 'Velvet Forest Latte',
  description: 'Single-origin espresso with oat milk',
  price: { amountInCents: 12500, currency: 'THB' },
  costPrice: { amountInCents: 4500, currency: 'THB' },
  categoryId: 'cat-coffee',
  barcode: '885100000001',
  taxRateBps: 700,
  currentStock: 18,
  reorderPoint: 5,
  unitOfMeasure: 'cup',
};

const sampleLowStockProduct: Product = {
  id: 'prod-croissant-02',
  storeId: 'store-01',
  sku: 'PAS-CRO-002',
  name: 'Artisan Butter Croissant',
  description: 'Flaky 72-layer butter pastry',
  price: { amountInCents: 8500, currency: 'THB' },
  costPrice: { amountInCents: 3000, currency: 'THB' },
  categoryId: 'cat-pastry',
  barcode: '885100000002',
  taxRateBps: 700,
  currentStock: 3,
  reorderPoint: 5,
  unitOfMeasure: 'piece',
};

const sampleOutOfStockProduct: Product = {
  id: 'prod-geisha-03',
  storeId: 'store-01',
  sku: 'COF-GEI-003',
  name: 'Specialty Geisha Reserve',
  price: { amountInCents: 29000, currency: 'THB' },
  costPrice: { amountInCents: 15000, currency: 'THB' },
  categoryId: 'cat-coffee',
  barcode: '885100000003',
  taxRateBps: 700,
  currentStock: 0,
  reorderPoint: 5,
  unitOfMeasure: 'cup',
};

test('ProductCard: in-stock product exposes accessible button, tabindex=0, formatted price, and focus ring', () => {
  const html = renderToString(
    React.createElement(LanguageProvider, null,
      React.createElement(ProductCard, { product: sampleInStockProduct, onAddToCart: () => {} })
    )
  );

  assert.match(html, /role="button"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-disabled="false"/);
  assert.match(html, /aria-label="Velvet Forest Latte, ฿125\.00"/);
  assert.match(html, /Velvet Forest Latte/);
  assert.match(html, /฿125\.00/);
  assert.match(html, /18/); // stock count
  assert.match(html, /focus-visible:ring-2/);
  assert.match(html, /focus-visible:ring-primary/);
});

test('ProductCard: low-stock product displays warning indicator with stock count', () => {
  const html = renderToString(
    React.createElement(LanguageProvider, null,
      React.createElement(ProductCard, { product: sampleLowStockProduct, onAddToCart: () => {} })
    )
  );

  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-disabled="false"/);
  assert.match(html, /3/); // stock count
  assert.match(html, /bg-amber-500\/10/); // warning subtle badge
});

test('ProductCard: out-of-stock product is disabled, tabindex=-1, and communicates status via text', () => {
  const html = renderToString(
    React.createElement(LanguageProvider, null,
      React.createElement(ProductCard, { product: sampleOutOfStockProduct, onAddToCart: () => {} })
    )
  );

  assert.match(html, /tabindex="-1"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /cursor-not-allowed/);
  assert.match(html, /สินค้าหมด/); // Explicit text status in Thai (default locale)
});

test('CartLineItem: quantity decrement, increment, and remove controls satisfy 44px touch targets and accessible labels', () => {
  const source = readFileSync(new URL('./CartLineItem.tsx', import.meta.url), 'utf8');

  // Verify accessible labels for all icon buttons
  assert.match(source, /aria-label="Decrease quantity"/);
  assert.match(source, /aria-label="Increase quantity"/);
  assert.match(source, /aria-label="Remove item from cart"/);

  // Verify minimum 44px touch targets
  assert.match(source, /min-h-\[44px\] min-w-\[44px\]/);
  assert.match(source, /focus-visible:ring-2 focus-visible:ring-cta/);
  assert.match(source, /focus-visible:ring-2 focus-visible:ring-rose-500/);
});

test('CartPanel & PaymentConfirmationModal: payment action uses orange CTA, destructive clear cart is danger-separated', () => {
  const cartPanelSource = readFileSync(new URL('./CartPanel.tsx', import.meta.url), 'utf8');
  const paymentModalSource = readFileSync(new URL('./PaymentConfirmationModal.tsx', import.meta.url), 'utf8');

  // Primary checkout button uses semantic CTA tokens with ink text
  assert.match(cartPanelSource, /bg-cta hover:bg-cta-hover active:bg-cta-pressed text-cta-text/);

  // Confirmation modal payment button uses semantic CTA tokens with ink text
  assert.match(paymentModalSource, /bg-cta hover:bg-cta-hover active:bg-cta-pressed text-cta-text/);

  // Clear Cart destructive action is visually separated using danger rose tokens
  assert.match(cartPanelSource, /text-rose-600 dark:text-rose-400/);
  assert.match(cartPanelSource, /bg-rose-50\/50/);

  // Manager Quick-Pay is distinct from standard checkout
  assert.match(cartPanelSource, /bg-amber-500 hover:bg-amber-400 text-black/);
});
