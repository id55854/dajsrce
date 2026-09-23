import {
  getProductionEnvironmentIssues,
  missingPublicSupabaseKeys,
} from "@/lib/env";

export function register() {
  if (process.env.VERCEL_ENV === "production") {
    const issues = getProductionEnvironmentIssues();
    if (issues.length > 0) {
      // Report only variable names/reasons, never values. Sensitive features
      // still fail closed in their own accessors/routes; a missing optional
      // integration must not take every public page offline.
      console.error("production_environment_invalid", { issues });
    }
    return;
  }

  // A fresh clone has no `.env.local` — it is git-ignored — and the first
  // thing anyone opens is the map, which then renders zero pins. Saying so at
  // boot costs one line and saves the reader from reading an empty country as
  // a broken query. `NEXT_RUNTIME` guards against printing it twice, since
  // `register` runs once per runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const missing = missingPublicSupabaseKeys();
  if (missing.length > 0) {
    console.warn(
      [
        "",
        "  The database is not configured, so the map will load zero pins.",
        `  Missing or still on a placeholder: ${missing.join(", ")}`,
        "  Copy .env.example to .env.local, fill in the Supabase Auth URL/anon key",
        "  and the Neon Data API URL/signing key, then restart this server.",
        "",
      ].join("\n")
    );
  }
}
