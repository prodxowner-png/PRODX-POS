# CF-01 Edge-to-Backend Service Identity Clarification

**Status:** Design clarification / mandatory contract input  
**Scope:** CF-01 Staging only  
**Production:** Existing mTLS contract unchanged  
**Runtime:** Not authorized

## Separate trust boundaries

CF-01 has two distinct machine-authentication hops. They must not be conflated:

1. **POS terminal -> Cloudflare Edge ingress:** Cloudflare Access Service Token authenticates the calling Edge integration client at ingress. The per-terminal ECDSA P-256 device signature authenticates the terminal's signed command at the application layer. The service token is shared ingress identity for the integration, not a terminal identity and not a human role.
2. **Cloudflare Worker -> trusted PRODX backend:** The backend must independently authenticate the Worker as an authorized Staging integration service. Do not assume that an incoming Access service-token JWT is automatically a valid backend audience assertion, and do not trust headers or claims that the Worker can freely copy from the POS request.

## Required backend assertion contract

Before Runtime implementation, choose and document one concrete backend authentication mechanism with:
- a dedicated Staging-only backend audience and issuer;
- a dedicated integration-client identity resolved server-side (e.g. an allowlisted Access common_name mapped to a server-owned integration-client record, or a separate short-lived signed Worker assertion);
- signature/issuer/audience/expiry validation at the backend, with explicit key/token rotation and revocation behavior;
- replay protection or bounded short-lived assertion semantics;
- strict separation from device identity and human PRODX authorization;
- no caller-controlled tenant/store/register/cashier/role claims accepted as authority.

The backend then independently resolves the device key ID and signed envelope to a server-owned terminal record, and derives organization/store/register/cashier/shift from backend-owned enrollment/session records. The Worker must forward the immutable signed command and evidence, not invent these identities.

## Required negative tests

- Missing, invalid, expired, wrong-issuer, or wrong-audience Worker assertion -> 401 and no financial writes.
- Unknown/revoked integration client -> deny and audit.
- Valid Worker assertion with invalid/revoked device key -> reject or Quarantine according to the approved device-key policy; never auto-commit.
- Forged tenant_id, terminal_id, store_id, register_id, cashier_id, role, or certificate fingerprint in headers/body -> ignored or rejected; no identity elevation.
- Replayed Worker assertion outside its allowed replay window -> reject.
- Cross-environment Staging/Production assertion -> reject.
- Access common_name must not imply human reviewer/approver permissions.

## Explicit non-actions

Do not disable Production certificate verification, accept client-supplied fingerprints, reuse Production credentials, create tokens/secrets/resources, modify DB schema/grants/RLS, deploy, merge, or implement Runtime under this design-only clarification.
