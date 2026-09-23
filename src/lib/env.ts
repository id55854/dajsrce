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
    "NEXT_PUBLIC_DATA_API_URL",
    "DATA_API_JWT_PRIVATE_JWK",
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

  const dataApiUrl = valueOf(env, "NEXT_PUBLIC_DATA_API_URL");
  if (dataApiUrl && !isValidUrl(dataApiUrl, true)) {
    issues.push({ key: "NEXT_PUBLIC_DATA_API_URL", reason: "must be a valid HTTPS URL" });
  }

  const appUrl = valueOf(env, "NEXT_PUBLIC_APP_URL");
  if (appUrl && !isValidUrl(appUrl, true)) {
    issues.push({ key: "NEXT_PUBLIC_APP_URL", reason: "must be a valid HTTPS URL in production" });
  }

  const cronSecret = valueOf(env, "CRON_SECRET");
  if (cronSecret && cronSecret.length < 32) {
    issues.push({ key: "CRON_SECRET", reason: "must contain at least 32 characters" });
  }

  if (valueOf(env, "ALLOW_LOCAL_FIXTURES")?.toLowerCase() === "true") {
    issues.push({ key: "ALLOW_LOCAL_FIXTURES", reason: "must be false or unset in production" });
  }

  return issues;
}

/**
 * The variables every anonymous read path needs, and which of them this
 * process is missing or has left on an `.env.example` placeholder.
 *
 * `.env.local` is git-ignored, so a fresh clone can only ever get one by hand.
 * Until it does, the public map, the city directory and every public detail
 * page fail exactly the way a database outage fails, and a new contributor
 * reads an empty map as "the server is down" rather than "I have no
 * credentials". Naming the gap is what separates the two.
 */
export const PUBLIC_SUPABASE_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  // Public reads run on the Neon Data API with a server-minted anon token.
  "NEXT_PUBLIC_DATA_API_URL",
  "DATA_API_JWT_PRIVATE_JWK",
] as const;

export function missingPublicSupabaseKeys(
  env: RuntimeEnvironment = process.env
): string[] {
  return PUBLIC_SUPABASE_KEYS.filter((key) => {
    const value = valueOf(env, key);
    return !value || isPlaceholder(value);
  });
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
