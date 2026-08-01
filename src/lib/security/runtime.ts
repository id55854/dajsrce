import { createHash, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LENGTH = 32;
type RuntimeEnvironment = Record<string, string | undefined>;

/** Demo billing must never be reachable from a production deployment. */
export function isDemoBillingEnabled(env: RuntimeEnvironment = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ALLOW_DEMO_BILLING === "true";
}

/**
 * Resolve the cron bearer secret. A missing/weak production secret is a server
 * configuration error, never an instruction to run the job without auth.
 */
export function getCronSecret(env: RuntimeEnvironment = process.env): string | null {
  const secret = env.CRON_SECRET?.trim() ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function bearerMatchesSecret(
  authorization: string | null,
  expectedSecret: string
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expectedSecret).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

/** Store only a digest; the raw bearer token belongs solely in the email URL. */
export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
