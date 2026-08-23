import { describe, expect, it } from "vitest";
import {
  assertProductionEnvironment,
  getProductionEnvironmentIssues,
  getSupabasePublicConfig,
} from "./env";

const validEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value",
  NEXT_PUBLIC_APP_URL: "https://dajsrce.example",
  CRON_SECRET: "long-random-cron-secret-at-least-32-chars",
  ALLOW_LOCAL_FIXTURES: "false",
};

describe("production environment validation", () => {
  it("accepts a complete production configuration", () => {
    expect(getProductionEnvironmentIssues(validEnvironment)).toEqual([]);
    expect(() => assertProductionEnvironment(validEnvironment)).not.toThrow();
  });

  it("allows the application to boot while cron remains fail-closed", () => {
    const environmentWithoutCron = { ...validEnvironment, CRON_SECRET: undefined };
    expect(getProductionEnvironmentIssues(environmentWithoutCron)).toEqual([]);
    expect(() => assertProductionEnvironment(environmentWithoutCron)).not.toThrow();
  });

  it("rejects the fixture toggle, insecure URLs, and weak configured secrets", () => {
    const issues = getProductionEnvironmentIssues({
      ...validEnvironment,
      NEXT_PUBLIC_APP_URL: "http://dajsrce.example",
      CRON_SECRET: "too-short",
      ALLOW_LOCAL_FIXTURES: "true",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "NEXT_PUBLIC_APP_URL" }),
        expect.objectContaining({ key: "CRON_SECRET" }),
        expect.objectContaining({ key: "ALLOW_LOCAL_FIXTURES" }),
      ])
    );
  });

  it("never silently substitutes placeholder Supabase credentials", () => {
    expect(() =>
      getSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "your_anon_key",
      })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() =>
      getSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "your_anon_key",
      })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
