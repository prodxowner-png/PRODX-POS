# CF-01 Device Signature Test Vectors v1

**Status:** Design/test-contract artifact; synthetic test-only fixtures  
**Scope:** CF-01 Staging protocol v1  
**Production:** Never use the public test key or fixture private key in Production.

These vectors define byte-level checks for RFC 8785 JCS, SHA-256 payload binding, and ECDSA P-256 verification. They are not Runtime implementation and do not authorize DB, Cloudflare, or deployment changes.

## 1. Test-only public key

Public JWK (the well-known test-only P-256 private scalar 1; the private scalar is intentionally not reproduced as a deployable secret and MUST NEVER be used outside disposable tests):

- kty: EC
- crv: P-256
- x: axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY
- y: T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU
- ext: true

Algorithm: ECDSA P-256 with SHA-256. Wire signature: 64-byte IEEE-P1363 r || s, base64url without padding.

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

{"domain":"prodx-pos-device-sale-payload/v1","protocol":"prodx-pos-device-sale/v1","sale":{"catalog_version":7,"client_recorded_at":"2026-11-11T10:00:00Z","currency":"THB","hlc":{"logical":0,"physical_ms":1730000000000},"idempotency_key":"idem-0001","lines":[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":2,"unit_price_minor":1250}],"sale_id":"33333333-3333-4333-8333-333333333333","signed_price_proofs":[],"terminal_seq_no":1},"tenant_id":"11111111-1111-4111-8111-111111111111","terminal_id":"22222222-2222-4222-8222-222222222222"}

- UTF-8 byte length: 550
- SHA-256: 6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454

### Tenant-binding negative vector

Change only tenant_id to aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa. Expected SHA-256: **941f2a9718f83e0ce1477ffc05ddd1a7734cddd89bff5b679fb6c4cdfe897bad**. All other fields remain identical. The hash MUST change.

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

Exact UTF-8 JCS bytes:

{"domain":"prodx-pos-device-sale-signature/v1","issued_at":"2026-11-11T10:00:01Z","key_id":"key-stg-0001","nonce":"AAECAwQFBgcICQoLDA0ODw","payload_hash":"6ddbb17cf4d8f579ed49ad4751fe61772bf07019a19094fce459961b8d726454","protocol":"prodx-pos-device-sale/v1","sale_id":"33333333-3333-4333-8333-333333333333","tenant_id":"11111111-1111-4111-8111-111111111111","terminal_id":"22222222-2222-4222-8222-222222222222","terminal_seq_no":1}

- UTF-8 byte length: 432
- SHA-256 of envelope bytes: ba4b783c9718d96e733631d45511003e2ef5143f56b42d2a3bab329654867f2b

## 4. Fixed valid signature

The following fixed P1363 signature verifies against the public JWK in Section 1 and the exact envelope bytes in Section 3:

**jvdQLc1de2oZHE9OVuYgoxgMNxVEkIVSx4I0-xMg3r2bqR6snpvWGxcG1OSxTZ7Nnmrn03ggHFB3t4gnTYHa9w**

Expected:
- base64url decoding yields exactly 64 bytes;
- P-256/SHA-256 verification succeeds;
- changing any signed envelope field causes verification failure;
- changing the payload while retaining the original hash/signature fails payload-hash verification;
- changing tenant or terminal changes the payload hash;
- DER signatures and padded/non-canonical base64url are rejected.

ECDSA signing may use a randomized nonce, so a newly generated signature need not byte-match this fixed signature. This is a verification known-answer test, not a deterministic-signing requirement.

## 5. Cross-runtime execution

Run the same fixture through:
1. POS terminal WebCrypto;
2. Cloudflare Worker verifier;
3. trusted backend Node.js verifier;
4. independent harness used by PostgreSQL integration tests.

Each runtime must produce exactly the same JCS bytes, payload hash, envelope bytes, and verification result. Production logic must compute values from input; precomputed values are test expectations only.

## 6. Negative and property tests

- Permute JSON object insertion order: JCS bytes and hash remain identical.
- Permute order-sensitive array elements: JCS bytes/hash change.
- Change quantity, unit price, product ID, sale ID, idempotency key, sequence, HLC, catalog version, tenant, or terminal: payload hash changes.
- Change key_id, issued_at, nonce, sequence, tenant, terminal, sale ID, or payload hash in the envelope: signature verification fails.
- Reject duplicate JSON member names before conversion to a normal object.
- Reject invalid UTF-8/Unicode, NaN/Infinity, unsafe integers, negative/zero quantity, fractional money, oversized payload, and unknown fields.
- Reject private JWK members in public-key registration, malformed coordinates, wrong curve/type, wrong signature length, malformed base64url, and DER signatures.
- A revoked-key upload routes to Quarantine regardless of signed client issued_at; assert zero financial writes.
- Exact duplicate quarantined upload resolves to the same case; altered payload with the same idempotency key is a permanent conflict.

## 7. Fixture provenance and safety

The SHA-256 values and signature were generated from the exact displayed UTF-8 strings using SHA-256 and P-256 ECDSA; the signature was locally verified against the displayed public key. Fixture IDs, product IDs, nonce, key ID, and sale data are synthetic. No production credential or production private key was used.
