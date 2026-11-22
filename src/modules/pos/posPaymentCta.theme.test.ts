import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cartPanel = readFileSync(new URL('./CartPanel.tsx', import.meta.url), 'utf8');
const paymentModal = readFileSync(new URL('./PaymentConfirmationModal.tsx', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

test('cart checkout action uses the semantic orange CTA with ink text', () => {
  assert.match(cartPanel, /bg-cta hover:bg-cta-hover active:bg-cta-pressed text-cta-text/);
  assert.doesNotMatch(cartPanel, /bg-primary hover:bg-primary\/95 text-white/);
});

test('payment confirmation action uses the semantic orange CTA and readable ink foreground', () => {
  assert.match(paymentModal, /bg-cta hover:bg-cta-hover active:bg-cta-pressed text-cta-text/);
  assert.doesNotMatch(paymentModal, /bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white/);
});

test('Tailwind exposes semantic CTA utilities backed by the approved token roles', () => {
  assert.match(globalCss, /--color-cta:\s*var\(--brand-cta\)/);
  assert.match(globalCss, /--color-cta-hover:\s*var\(--brand-cta-hover\)/);
  assert.match(globalCss, /--color-cta-pressed:\s*var\(--brand-cta-pressed\)/);
  assert.match(globalCss, /--color-cta-text:\s*var\(--brand-cta-text\)/);
});
