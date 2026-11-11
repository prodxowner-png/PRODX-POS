import assert from "node:assert/strict";
import { generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { test } from "node:test";
import worker from "../src/index.ts";

const token = "oci-bridge-test-token-".padEnd(48, "x");
const tenancyId = "ocid1.tenancy.oc1..prodx-test";
const userId = "ocid1.user.oc1..prodx-test";
const fingerprint = "aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

const env = {
  BRIDGE_AUTH_TOKEN: token,
  OCI_TENANCY_OCID: tenancyId,
  OCI_USER_OCID: userId,
  OCI_FINGERPRINT: fingerprint,
  OCI_REGION: "ap-singapore-1",
  OCI_PRIVATE_KEY_PEM: privateKey
};

test("GET /health reports local health without contacting OCI", async () => {
  const response = await worker.fetch(new Request("https://bridge.example/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "prodx-oci-bridge",
    status: "ready",
    integration: "read-only"
  });
});

test("rejects unauthenticated tenancy requests", async () => {
  const response = await worker.fetch(new Request("https://bridge.example/v1/oci/tenancy"), env);
  assert.equal(response.status, 401);
});

test("rejects non-GET methods", async () => {
  const response = await worker.fetch(new Request("https://bridge.example/v1/oci/tenancy", { method: "POST" }), env);
  assert.equal(response.status, 405);
});

test("rejects unknown paths", async () => {
  const response = await worker.fetch(new Request("https://bridge.example/v1/oci/compartments", {
    headers: { authorization: "Bearer " + token }
  }), env);
  assert.equal(response.status, 404);
});

test("rejects query parameters instead of silently ignoring them", async () => {
  const response = await worker.fetch(new Request("https://bridge.example/v1/oci/tenancy?compartmentId=attacker-controlled", {
    headers: { authorization: "Bearer " + token }
  }), env);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "query_not_allowed" });
});

test("signs the fixed OCI tenancy GET and returns only allowlisted fields", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let verified = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input);
    const requestHeaders = new Headers(init?.headers);
    const date = requestHeaders.get("date");
    const authorization = requestHeaders.get("authorization") ?? "";
    const signature = /signature="([^"]+)"/.exec(authorization)?.[1];
    const path = "/" + "20160918" + "/tenancies/" + encodeURIComponent(tenancyId);
    const host = "identity.ap-singapore-1.oraclecloud.com";
    assert.ok(date);
    assert.ok(signature);
    const signingString = [
      "(request-target): get " + path,
      "host: " + host,
      "date: " + date
    ].join("\n");
    verified = verifySignature(
      "RSA-SHA256",
      Buffer.from(signingString),
      publicKey,
      Buffer.from(signature, "base64")
    );
    return new Response(JSON.stringify({
      id: tenancyId,
      name: "PRODX Test Tenancy",
      homeRegionKey: "SIN",
      lifecycleState: "ACTIVE",
      timeCreated: "2026-01-01T00:00:00.000Z",
      secretField: "must-not-be-returned"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const response = await worker.fetch(new Request("https://bridge.example/v1/oci/tenancy", {
      headers: { authorization: "Bearer " + token }
    }), env);
    assert.equal(response.status, 200);
    assert.equal(calledUrl, "https://identity.ap-singapore-1.oraclecloud.com/20160918/tenancies/" + encodeURIComponent(tenancyId));
    assert.equal(verified, true);
    assert.deepEqual(await response.json(), {
      tenancy: {
        id: tenancyId,
        name: "PRODX Test Tenancy",
        home_region_key: "SIN",
        lifecycle_state: "ACTIVE",
        time_created: "2026-01-01T00:00:00.000Z"
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("supports unencrypted OCI RSA PKCS#1 PEM keys", async () => {
  const keyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  assert.ok(keyPair.privateKey.startsWith("-----BEGIN RSA PRIVATE KEY-----"));
  const originalFetch = globalThis.fetch;
  let verified = false;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const requestHeaders = new Headers(init?.headers);
    const date = requestHeaders.get("date");
    const authorization = requestHeaders.get("authorization") ?? "";
    const signature = /signature="([^"]+)"/.exec(authorization)?.[1];
    assert.ok(date);
    assert.ok(signature);
    const path = "/20160918/tenancies/" + encodeURIComponent(tenancyId);
    const signingString = [
      "(request-target): get " + path,
      "host: identity.ap-singapore-1.oraclecloud.com",
      "date: " + date
    ].join("\\n");
    verified = verifySignature("RSA-SHA256", Buffer.from(signingString), keyPair.publicKey, Buffer.from(signature, "base64"));
    return new Response(JSON.stringify({ id: tenancyId, name: "PKCS1 Test Tenancy" }), { status: 200 });
  }) as typeof fetch;

  try {
    const response = await worker.fetch(new Request("https://bridge.example/v1/oci/tenancy", {
      headers: { authorization: "Bearer " + token }
    }), { ...env, OCI_PRIVATE_KEY_PEM: keyPair.privateKey });
    assert.equal(response.status, 200);
    assert.equal(verified, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
