# CF-01 Staging Signature Canonicalization Hardening Addendum

**Status:** Normative design addendum for CF-01 Staging only  
**Applies to:** `docs/cf01-device-signature-protocol-v1.md` and `docs/cf01-device-signature-test-vectors-v1.md`  
**Production:** No change. Production remains on its existing mTLS contract.  
**Authorization boundary:** Design and security-test contract only; no Runtime, DB, Cloudflare, secret, deployment, merge, or Production changes.

## 1. ECDSA P-256 low-S is mandatory

The protocol's phrase "non-canonical encodings" is insufficiently precise. Version 1 MUST require canonical low-S ECDSA signatures:

- Let `n = FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551`, the P-256 subgroup order.
- Decode the 64-byte IEEE-P1363 signature as unsigned 32-byte big-endian `r || s`.
- Require `1 <= r < n` and `1 <= s <= floor(n/2)`.
- Reject high-S signatures; do not silently normalize received signatures.
- Signers MUST normalize generated signatures to `s = min(s, n-s)` before encoding.
- Re-encode exactly 64 bytes and base64url without padding. Reject padded encodings, alternate alphabets, invalid characters, non-zero unused trailing bits, and any value whose decode/re-encode round trip is not byte-for-byte identical.

This prevents the mathematically equivalent `(r, n-s)` representation from being accepted as a second wire representation of the same ECDSA proof. The verifier must reject, not repair, non-canonical input.

## 2. Corrected signature known-answer vectors

The original fixed signature in Section 4 of `cf01-device-signature-test-vectors-v1.md` is cryptographically valid for the documented envelope, but its `s` component is greater than `n/2`. Therefore it is a **negative high-S vector**, not a valid v1 wire signature. This addendum supersedes the prior expectation that it should be accepted.

For the exact envelope bytes and test public key already documented in the vector file:

- Positive low-S signature (base64url, no padding):

`rX3QpYTa3eqzDf9TiDl6dsqnmGs8EZ7mhoEqGwkVEesmTHkG18Z5ZQU7E8a0FD9s3qEBx8j4-LGluBqIsKMssA`

- Expected decoded length: 64 bytes.
- Expected: P-256/SHA-256 verification succeeds and `s <= floor(n/2)`.
- Negative high-S signature (the former fixed signature):

`jvdQLc1de2oZHE9OVuYgoxgMNxVEkIVSx4I0-xMg3r2bqR6snpvWGxcG1OSxTZ7Nnmrn03ggHFB3t4gnTYHa9w`

- Expected: mathematical ECDSA verification succeeds if low-S policy is omitted, but the protocol v1 verifier MUST reject it because `s > floor(n/2)`.

ECDSA signing is randomized; tests must assert verification and canonicality, not byte equality of newly generated signatures. The two fixed values above are verification fixtures only and must never be used outside disposable tests.

## 3. Duplicate JSON member names must be rejected before object materialization

RFC 8785 canonicalization does not define how an implementation should resolve duplicate JSON object member names. Different parsers may keep the first value, keep the last value, or reject the input. Canonicalizing an already-materialized object cannot recover discarded duplicates.

Therefore every ingress/backend parser MUST:

1. Enforce the streaming request byte limit before buffering the complete body.
2. Decode UTF-8 strictly; reject malformed sequences and invalid Unicode scalar values.
3. Tokenize/parse while tracking member names independently for each object scope.
4. Reject a repeated decoded member name in the same object, including names that become equal after JSON escape decoding (for example, `"a"` and `"\u0061"`).
5. Reject trailing non-whitespace data, invalid JSON number grammar, non-finite values, and unsupported numeric forms.
6. Only after these checks, validate the closed protocol schema and construct the canonical object.

Do not rely on `JSON.parse` alone where the runtime silently accepts duplicate member names. Do not canonicalize a lossy parse result.

## 4. Exact numeric domain for JCS

JCS uses ECMAScript-compatible number serialization. To avoid cross-runtime monetary and sequence drift:

- All money fields are integer minor units, never binary floating-point decimal amounts.
- Integer fields used in the signed protocol MUST be safe integers in the interoperable range `[-(2^53-1), +(2^53-1)]`; domain schemas should narrow this further to non-negative bounded ranges where appropriate.
- Quantities, sequence numbers, HLC components, catalog versions, and timestamps each require explicit integer bounds and semantic validation.
- Reject NaN, infinities, negative zero where the field schema does not permit it, exponent forms if the field's wire schema requires canonical integer tokens, and decimal values in integer-only fields.
- Do not convert a parsed floating-point value into an integer after parsing and assume the original wire representation was safe. Validate token form and range.

The business schema must specify bounds; this addendum does not invent maximum sale quantities, sequence windows, or retention periods.

## 5. Cross-runtime security test matrix additions

Add these cases to the shared suite and require identical outcomes in terminal WebCrypto, Cloudflare Worker, backend Node.js, and the independent PostgreSQL integration harness:

| Case | Expected |
|---|---|
| Fixed low-S fixture above | Accept signature |
| Former fixed high-S fixture | Reject as non-canonical before financial processing |
| `r = 0`, `s = 0`, `r >= n`, or `s >= n` | Reject |
| Valid signature transformed from `s` to `n-s` | Reject high-S form |
| Padded base64url or non-canonical trailing bits | Reject |
| DER-encoded signature | Reject |
| Duplicate literal JSON member | Reject before canonicalization |
| Duplicate escaped-equivalent member (`"a"` and `"\u0061"`) | Reject before canonicalization |
| Invalid UTF-8, lone surrogate, trailing JSON token | Reject |
| Unsafe integer, fractional minor unit, exponent-form integer token | Reject under integer-only schema |
| Same semantic payload with alternate object key order | Canonical bytes/hash identical after strict parse |
| Same key/value pairs but duplicate member injection | Reject, never select first/last value |

A release candidate is not considered cross-runtime verified until these tests execute in every target runtime and their results are attached to the exact commit.

## 6. Gate

This addendum closes specification ambiguity only. It does not claim that cross-runtime tests have run, that protocol interoperability is proven, or that any Runtime implementation is ready. Independent security review, Quarantine policy approval, B1–B8 resolution, exact-head CI, and isolated live Staging E2E remain mandatory before CF-01 can leave HOLD.
