type RuntimeEnvironment = Record<string, string | undefined>;

export type EnvironmentIssue = {
  key: string;
  reason: string;
};

const PLACEHOLDER = /^(?:placeholder|your_|change[-_ ]?me|example(?:\.com)?).*/i;

function valueOf(env: RuntimeEnvironment, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value) || value.includes("YOUR_PROJECT");
}

function isValidUrl(value: string, requireHttps: boolean): boolean {
  try {
    const url = new URL(value);
    if (requireHttps && url.protocol !== "https:") return false;
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getProductionEnvironmentIssues(
  env: RuntimeEnvironment = process.env
): EnvironmentIssue[] {
  const issues: EnvironmentIssue[] = [];
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_APP_URL",
  ];

  for (const key of required) {
    const value = valueOf(env, key);
    if (!value) {
      issues.push({ key, reason: "is required" });
    } else if (isPlaceholder(value)) {
      issues.push({ key, reason: "still contains a placeholder value" });
    }
  }

  const supabaseUrl = valueOf(env, "NEXT_PUBLIC_SUPABASE_URL");
  if (supabaseUrl && !isValidUrl(supabaseUrl, true)) {
    issues.push({ key: "NEXT_PUBLIC_SUPABASE_URL", reason: "must be a valid HTTPS URL" });
  }

  const appUrl = valueOf(env, "NEXT_PUBLIC_APP_URL");
  if (appUrl && !isValidUrl(appUrl, true)) {
    issues.push({ key: "NEXT_PUBLIC_APP_URL", reason: "must be a valid HTTPS URL in production" });
  }

  const cronSecret = valueOf(env, "CRON_SECRET");
  if (cronSecret && cronSecret.length < 32) {
    issues.push({ key: "CRON_SECRET", reason: "must contain at least 32 characters" });
  }

  if (valueOf(env, "ALLOW_DEMO_BILLING")?.toLowerCase() === "true") {
    issues.push({ key: "ALLOW_DEMO_BILLING", reason: "must be false or unset in production" });
  }

  if (valueOf(env, "ALLOW_LOCAL_FIXTURES")?.toLowerCase() === "true") {
    issues.push({ key: "ALLOW_LOCAL_FIXTURES", reason: "must be false or unset in production" });
  }

  return issues;
}

/** Local fixtures are explicit development data, never a production failover. */
export function areLocalFixturesEnabled(env: RuntimeEnvironment = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ALLOW_LOCAL_FIXTURES === "true";
}

export function assertProductionEnvironment(
  env: RuntimeEnvironment = process.env
): void {
  const issues = getProductionEnvironmentIssues(env);
  if (issues.length === 0) return;

  const summary = issues.map(({ key, reason }) => `${key} ${reason}`).join("; ");
  throw new Error(`Unsafe production environment: ${summary}`);
}

export function requireEnvironmentVariable(
  key: string,
  env: RuntimeEnvironment = process.env
): string {
  const value = valueOf(env, key);
  if (!value || isPlaceholder(value)) {
    throw new Error(`Missing or unsafe environment variable: ${key}`);
  }
  return value;
}

export function getSupabasePublicConfig(env: RuntimeEnvironment = process.env): {
  url: string;
  anonKey: string;
} {
  return {
    url: requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL", env),
    anonKey: requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_ANON_KEY", env),
  };
}
