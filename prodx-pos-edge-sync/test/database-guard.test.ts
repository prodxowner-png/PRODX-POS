import { describe, expect, it } from "vitest";
import { assertDisposableCiDatabasePair, assertDisposableCiDatabaseUrl } from "../scripts/test-database-guard.js";

const env = { POS_CI_MODE: "true", NODE_ENV: "test" };
const admin = "postgres://postgres:admin@localhost:5432/prodx_pos_ci";
const runtime = "postgres://prodx_pos_worker:worker@localhost:5432/prodx_pos_ci";

describe("Edge PostgreSQL integration database guard", () => {
  it("accepts a local dedicated CI database and separate runtime role", () => {
    expect(assertDisposableCiDatabasePair(admin, runtime, "test", env)).toEqual({
      adminUrl: admin,
      runtimeUrl: runtime,
    });
  });

  it("rejects missing explicit CI opt-in", () => {
    expect(() => assertDisposableCiDatabaseUrl(admin, "test", { NODE_ENV: "test" }))
      .toThrow(/POS_CI_MODE=true/);
  });

  it("rejects production runtime environments", () => {
    expect(() => assertDisposableCiDatabaseUrl(admin, "test", { ...env, NODE_ENV: "production" }))
      .toThrow(/production runtime/);
  });

  it("rejects remote database hosts and host/hostaddr/port overrides", () => {
    for (const url of [
      "postgres://postgres:admin@db.example.com:5432/prodx_pos_ci",
      `${admin}?host=db.example.com`,
      `${admin}?hostaddr=203.0.113.10`,
      `${admin}?port=6432`,
    ]) expect(() => assertDisposableCiDatabaseUrl(url, "test", env)).toThrow();
  });

  it("rejects non-dedicated database names and mismatched targets", () => {
    expect(() => assertDisposableCiDatabaseUrl("postgres://postgres:admin@localhost:5432/postgres", "test", env))
      .toThrow(/dedicated prodx_pos/);
    expect(() => assertDisposableCiDatabasePair(admin, runtime.replace("prodx_pos_ci", "prodx_pos_other_ci"), "test", env))
      .toThrow(/same disposable PostgreSQL database/);
  });

  it("rejects administrator or unknown roles for runtime writes", () => {
    expect(() => assertDisposableCiDatabasePair(admin, "postgres://postgres:other@localhost:5432/prodx_pos_ci", "test", env))
      .toThrow(/dedicated prodx_pos_worker/);
    expect(() => assertDisposableCiDatabasePair(admin, "postgres://other_role:worker@localhost:5432/prodx_pos_ci", "test", env))
      .toThrow(/dedicated prodx_pos_worker/);
  });
});
