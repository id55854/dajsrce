import { getProductionEnvironmentIssues } from "@/lib/env";

export function register() {
  if (process.env.VERCEL_ENV === "production") {
    const issues = getProductionEnvironmentIssues();
    if (issues.length > 0) {
      // Report only variable names/reasons, never values. Sensitive features
      // still fail closed in their own accessors/routes; a missing optional
      // integration must not take every public page offline.
      console.error("production_environment_invalid", { issues });
    }
  }
}
