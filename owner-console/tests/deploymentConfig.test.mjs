import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const vercel = JSON.parse(read("../vercel.json"));
const envExample = read("../.env.example");

function globalHeaders() {
  const rule = vercel.headers?.find((entry) => entry.source === "/(.*)");
  assert.ok(rule, "vercel.json must define security headers for every route");
  return new Map(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

function cspDirectives() {
  const policy = globalHeaders().get("content-security-policy");
  assert.ok(policy, "Content-Security-Policy header is required");
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources];
      }),
  );
}

describe("vercel.json security headers", () => {
  it("blocks framing, plugins, base-URI hijacking and cross-origin form posts", () => {
    const csp = cspDirectives();
    assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(csp.get("object-src"), ["'none'"]);
    assert.deepEqual(csp.get("base-uri"), ["'self'"]);
    assert.deepEqual(csp.get("form-action"), ["'self'"]);
    assert.equal(globalHeaders().get("x-frame-options"), "DENY");
  });

  it("only runs same-origin scripts and never allows eval or wildcard sources", () => {
    const csp = cspDirectives();
    assert.deepEqual(csp.get("script-src"), ["'self'"]);
    for (const [directive, sources] of csp) {
      assert.equal(sources.includes("*"), false, `${directive} must not allow *`);
      assert.equal(
        sources.includes("'unsafe-eval'"),
        false,
        `${directive} must not allow unsafe-eval`,
      );
    }
  });

  it("restricts connect-src to the dedicated Owner Auth origin from .env.example", () => {
    const urlLine = envExample
      .split(/\r?\n/)
      .find((line) => line.startsWith("VITE_SUPABASE_URL="));
    assert.ok(urlLine, ".env.example must declare VITE_SUPABASE_URL");
    const ownerAuthOrigin = new URL(
      urlLine.slice("VITE_SUPABASE_URL=".length).trim(),
    ).origin;
    assert.deepEqual(cspDirectives().get("connect-src"), ["'self'", ownerAuthOrigin]);
  });

  it("sets anti-sniffing, referrer and indexing protections", () => {
    const headers = globalHeaders();
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("referrer-policy"), "no-referrer");
    assert.match(headers.get("x-robots-tag") ?? "", /noindex/);
  });
});

describe("CSP-compatible application markup", () => {
  it("does not use inline style attributes that strict style-src would block", () => {
    const app = read("../src/App.tsx");
    assert.doesNotMatch(app, /\bstyle\s*=\s*\{/);
    assert.match(app, /owner-mfa-notice/);
    assert.match(app, /owner-totp-qr/);
    assert.match(app, /owner-totp-form/);
    assert.match(app, /audit-panel/);
    assert.doesNotMatch(app, /style\s*=\s*\{/);
  });
});

describe("Vercel build parity with CI", () => {
  it("pins npm and verifies the lifecycle-script policy before npm ci", () => {
    assert.match(vercel.installCommand, /npm@11\.21\.2/);
    assert.match(vercel.installCommand, /strict-allow-scripts/);
    assert.match(vercel.installCommand, /npm ci/);
  });
});

describe("Owner Edge Function CI coverage", () => {
  it("typechecks the deployed Deno entrypoint and uses a pinned npm specifier", () => {
    const authorizeEntrypoint = read("../../supabase/functions/owner-authorize/index.ts");
    const auditEntrypoint = read("../../supabase/functions/owner-audit/index.ts");
    const workflow = read("../../.github/workflows/owner-console.yml");
    for (const entrypoint of [authorizeEntrypoint, auditEntrypoint]) {
      assert.match(entrypoint, /npm:@supabase\/supabase-js@2\.117\.2/);
      assert.doesNotMatch(entrypoint, /https:\/\/esm\.sh\//);
    }
    assert.match(workflow, /denoland\/setup-deno@[0-9a-f]{40}/);
    assert.match(workflow, /deno check --no-lock --node-modules-dir=none \.\.\/supabase\/functions\/owner-authorize\/index\.ts/);
    assert.match(workflow, /deno check --no-lock --node-modules-dir=none \.\.\/supabase\/functions\/owner-audit\/index\.ts/);
    assert.match(workflow, /postgres:17-alpine/);
  });
});

describe("Owner Auth project configuration", () => {
  it("enforces gateway JWT verification for owner-authorize", () => {
    const toml = read("../../supabase/config.toml");
    const section = toml
      .split(/^\[/m)
      .find((part) => part.startsWith("functions.owner-authorize]"));
    assert.ok(section, "[functions.owner-authorize] must be declared");
    assert.match(section, /^verify_jwt\s*=\s*true\s*$/m);
    const auditSection = toml
      .split(/^\[/m)
      .find((part) => part.startsWith("functions.owner-audit]"));
    assert.ok(auditSection, "[functions.owner-audit] must be declared");
    assert.match(auditSection, /^verify_jwt\s*=\s*true\s*$/m);
    assert.match(toml, /^project_id\s*=\s*"[^"]+"/m);
  });

  it("never lets the browser client adopt sessions from the URL", () => {
    assert.match(read("../src/lib/supabase.ts"), /detectSessionInUrl:\s*false/);
  });

  it(".env.example contains only browser-safe VITE_ entries", () => {
    const entries = envExample
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"));
    for (const entry of entries) {
      assert.match(entry, /^VITE_[A-Z_]+=/, `unexpected env entry: ${entry.split("=")[0]}`);
    }
    assert.equal(/sb_secret_|service_role/i.test(envExample), false);
  });
});
