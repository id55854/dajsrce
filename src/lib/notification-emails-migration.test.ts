import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATION = "20260928100000_notification_emails.sql";

let sql = "";
let executable = "";

function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is not defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `${name} has no terminator`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

beforeAll(async () => {
  sql = await readFile(path.join(process.cwd(), "supabase", "migrations", MIGRATION), "utf8");
  executable = sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
});

describe("notification e-mail migration", () => {
  it("runs in one transaction and defaults the preference to on", () => {
    expect(executable.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(executable.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(executable).toContain(
      "ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true"
    );
  });

  it("keeps the queue and the token digests away from every API role", () => {
    for (const table of ["notification_emails", "notification_email_unsubscribe_tokens"]) {
      expect(executable).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(executable).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated;`);
    }
    expect(executable).not.toMatch(/GRANT [^;]*ON public\.notification_email/i);
    expect(executable).not.toMatch(/GRANT EXECUTE[^;]*\b(anon|authenticated)\b/i);
  });

  it("hardens every security-definer function and grants only service_role", () => {
    const definers = sql.match(/^SECURITY DEFINER\s*$/gm)?.length ?? 0;
    const hardened = sql.match(/^SECURITY DEFINER\s*\r?\nSET search_path = pg_catalog, public$/gm)?.length ?? 0;
    // The trigger function and the four RPCs.
    expect(definers).toBe(5);
    expect(hardened).toBe(definers);
    for (const signature of [
      "claim_notification_email_batches(integer)",
      "complete_notification_email_batch(uuid, text, text)",
      "unsubscribe_notification_emails(text)",
      "set_email_notifications(uuid, boolean)",
    ]) {
      expect(executable).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
      expect(executable).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
    expect(executable).toContain("REVOKE ALL ON FUNCTION public.enqueue_notification_email() FROM PUBLIC, anon, authenticated;");
  });

  it("queues every notification except the reminder the reminder cron already e-mails", () => {
    const enqueue = functionBody("enqueue_notification_email");
    expect(enqueue).toContain("IF NEW.reminder_event_id IS NOT NULL THEN");
    expect(enqueue).toContain("AND p.email_notifications_enabled");
    expect(executable).toMatch(
      /CREATE TRIGGER notifications_enqueue_email\s+AFTER INSERT ON public\.notifications\s+FOR EACH ROW EXECUTE FUNCTION public\.enqueue_notification_email\(\);/
    );
  });

  it("groups and paces messages per person and never stores a raw token", () => {
    const claim = functionBody("claim_notification_email_batches");
    expect(claim).toContain("recent.sent_at > v_now - interval '10 minutes'");
    expect(claim).toContain("LIMIT 10");
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("e.created_at < v_now - interval '3 days'");
    expect(claim).toContain("NOT p.email_notifications_enabled");
    expect(claim).toContain("encode(extensions.gen_random_bytes(32), 'hex')");
    expect(claim).toContain("VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_user)");
    expect(executable).toContain("token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$')");
  });

  it("gives up after five attempts and turns e-mail off for an unsubscribe", () => {
    const complete = functionBody("complete_notification_email_batch");
    expect(complete).toContain("CASE WHEN e.attempts >= 5 THEN 'failed' ELSE 'pending' END");
    expect(complete).toContain("p_outcome NOT IN ('sent', 'retry', 'skipped')");
    const unsubscribe = functionBody("unsubscribe_notification_emails");
    expect(unsubscribe).toContain("p_token_hash !~ '^[0-9a-f]{64}$'");
    expect(unsubscribe).toContain("SET email_notifications_enabled = false");
    expect(unsubscribe).toContain("'notification_email.unsubscribe'");
  });
});
