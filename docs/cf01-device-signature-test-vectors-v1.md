# CF-01 Device Signature Test Vectors v1

**Status:** Design/test-contract artifact; synthetic test-only fixtures  
**Scope:** CF-01 Staging protocol v1  
**Production:** Never use the public test key or fixture private key in Production.

These fixtures define RFC 8785 JCS, SHA-256 payload binding, and ECDSA P-256 verification. Canonical signature acceptance is governed by the low-S profile below and the normative addendum `docs/cf01-signature-canonicalization-hardening.md`.

## 1. Test-only public key

Public JWK (well-known P-256 public key corresponding to test-only scalar 1; never use the private scalar outside disposable tests):

- kty: EC
- crv: P-256
- x: axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY
- y: T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU
- ext: true

Algorithm: ECDSA P-256 with SHA-256. Wire signature: 64-byte IEEE-P1363 `r || s`, base64url without padding.

## 2. Canonical payload fixture

Input object fields:
- domain = prodx-pos-device-sale-payload/v1
- protocol = prodx-pos-device-sale/v1
- tenant_id = 11111111-1111-4111-8111-111111111111
- terminal_id = 22222222-2222-4222-8222-222222222222
- sale.idempotency_key = idem-0001
- sale.sale_id = 33333333-3333-4333-8333-333333333333
- sale.terminal_seq_no = 1
- sale.hlc = {logical: 0, physical_ms: 1730000000000}
- sale.catalog_version = 7
- sale.signed_price_proofs = []
- sale.client_recorded_at = 2026-11-11T10:00:00Z
- sale.currency = THB
- sale.lines = [{product_id: 44444444-4444-4444-8444-444444444444, quantity: 2, unit_price_minor: 1250}]

Exact UTF-8 JCS bytes (single line):

`{"domain":"prodx-pos-device-sale-payload/v1","protocol":"prodx-pos-device-sale/v1","sale":{"catalog_version":7,"client_recorded_at":"2026-11-11T10:00:00Z","currency":"THB","hlc":{"logical":0,"physical_ms":1730000000000},"idempotency_key":"idem-0001","lines":[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":2,"unit_price_minor":1250}],"sale_id":"33333333-3333-4333-8333-333333333333","signed_price_proofs":[],"terminal_seq_no":1},"tenant_id":"11111111-1111-4111-8111-111111111111","terminal_id":"22222222-2222-4222-8222-222222222222"}`

- UTF-8 byte length: 550
- SHA-256: `6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454`

### Tenant-binding negative vector

Change only tenant_id to aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa. Expected SHA-256: `941f2a9718f83e0ce1477ffc05ddd1a7734cddd89bff5b679fb6c4cdfe897bad`. All other fields remain identical. The hash MUST change.

## 3. Canonical signature envelope fixture

Envelope fields:
- domain = prodx-pos-device-sale-signature/v1
- protocol = prodx-pos-device-sale/v1
- key_id = key-stg-0001
- tenant_id = 11111111-1111-4111-8111-111111111111
- terminal_id = 22222222-2222-4222-8222-222222222222
- sale_id = 33333333-3333-4333-8333-333333333333
- terminal_seq_no = 1
- payload_hash = 6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454
- issued_at = 2026-11-11T10:00:01Z
- nonce = AAECAwQFBgcICQoLDA0ODw

Exact UTF-8 JCS bytes (single line):

`{"domain":"prodx-pos-device-sale-signature/v1","issued_at":"2026-11-11T10:00:01Z","key_id":"key-stg-0001","nonce":"AAECAwQFBgcICQoLDA0ODw","payload_hash":"6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454","protocol":"prodx-pos-device-sale/v1","sale_id":"33333333-3333-4333-8333-333333333333","tenant_id":"11111111-1111-4111-8111-111111111111","terminal_id":"22222222-2222-4222-8222-222222222222","terminal_seq_no":1}`

- UTF-8 byte length: 432
- SHA-256: `ba4b783c9718d96e733631d45511003e2ef5143f56b42d2a3bab329654867f2b`

## 4. Signature known-answer vectors — mandatory low-S profile

Let P-256 subgroup order `n = FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551`. Decode P1363 `r || s` as two unsigned 32-byte big-endian integers. Require `1 <= r < n` and `1 <= s <= floor(n/2)`. Signers normalize generated signatures to `s = min(s, n-s)`; verifiers MUST reject high-S signatures and MUST NOT normalize inbound signatures.

### Positive vector — canonical low-S

**`rX3QpYTa3eqzDf9TiDl6dsqnmGs8EZ7mhoEqGwkVEesmTHkG18Z5ZQU7E8a0FD9s3qEBx8j4-LGluBqIsKMssA`**

Expected: decode to exactly 64 bytes; r/s in range; low-S; P-256/SHA-256 verification succeeds for the exact envelope in Section 3.

### Negative vector — mathematically valid high-S

The former fixed signature was mathematically valid but had `s > floor(n/2)`. It is now a negative vector and MUST be rejected by protocol v1:

**`jvdQLc1de2oZHE9OVuYgoxgMNxVEkIVSx4I0-xMg3r2bqR6snpvWGxcG1OSxTZ7Nnmrn03ggHFB3t4gnTYHa9w`**

Expected: raw ECDSA verification succeeds if low-S policy is omitted, but protocol verification rejects it as non-canonical.

Also reject r=0, s=0, r>=n, s>=n, DER, padded base64url, alternate alphabet, invalid characters, non-zero unused trailing bits, and any non-round-tripping encoding.

## 5. Cross-runtime execution

Run the same fixtures through:
1. POS terminal WebCrypto;
2. Cloudflare Worker verifier;
3. trusted backend Node.js verifier;
4. independent PostgreSQL integration-test harness.

Each runtime must produce identical JCS bytes, hashes, envelope bytes, and verification results. These executions have **not yet been demonstrated** by the local fixture check; do not claim cross-runtime interoperability until CI or attached run evidence shows all target runtimes passed.

## 6. Negative and property tests

- Permute JSON object insertion order: JCS bytes/hash remain identical.
- Permute order-sensitive array elements: JCS bytes/hash change.
- Change quantity, unit price, product ID, sale ID, idempotency key, sequence, HLC, catalog version, tenant, or terminal: payload hash changes.
- Change any signed envelope field: signature verification fails.
- Reject duplicate JSON member names before object materialization, including escaped-equivalent names such as `"a"` and `"\\u0061"`.
- Reject invalid UTF-8/Unicode, trailing JSON tokens, NaN/Infinity, unsafe integers, exponent/fraction forms in integer-only fields, forbidden negative zero, negative/zero quantity, fractional money, oversized payload, and unknown fields.
- Reject private JWK members, malformed coordinates, wrong curve/type, wrong signature length, malformed/non-canonical base64url, DER, and high-S signatures.
- A revoked-key upload routes to Quarantine regardless of signed client issued_at; assert zero financial writes.
- Exact duplicate quarantined upload resolves to the same case; altered payload with same idempotency key is a permanent conflict.

## 7. Fixture provenance and safety

The SHA-256 values and signatures were verified against the exact displayed envelope and public key. Fixture IDs, product IDs, nonce, key ID, and sale data are synthetic. No production credential or production private key was used.
