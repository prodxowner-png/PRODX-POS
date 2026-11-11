# PRODX OCI Bridge (read-only)

Initial allowlist:
- GET /health — local health only; no OCI call.
- GET /v1/oci/tenancy — OCI GetTenancy read using RSA-SHA256 request signing.

All other paths return 404 and all non-GET methods return 405. Region is pinned to ap-singapore-1; no caller-supplied host, path, region, compartment or query parameters are accepted. Response fields are allowlisted. OCI upstream bodies are never forwarded.

Required Worker secrets:
- BRIDGE_AUTH_TOKEN (minimum 32 characters)
- OCI_PRIVATE_KEY_PEM (unencrypted PKCS#8 PEM)

Required non-secret variables:
- OCI_TENANCY_OCID
- OCI_USER_OCID
- OCI_FINGERPRINT
- OCI_REGION=ap-singapore-1

The key must match the public API signing key registered to the OCI user and the configured fingerprint. The Worker signs GET requests with RSASSA-PKCS1-v1_5 / SHA-256.

Deployment is intentionally disabled for workers.dev. Do not expose a public hostname until a dedicated Access application and caller identity policy exist. Deploy to a staging target first; this bridge must not create, update or delete OCI resources.
