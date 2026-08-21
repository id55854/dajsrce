import type { BadgeTone } from "@/components/ui";

/**
 * Presentation shared by the two places an official register record is shown:
 * its own page under `/organisations/[id]` and the map's side panel.
 *
 * Both render the same facts from the same RPC, so the status vocabulary, the
 * URL hardening and the field layout live here rather than being written twice
 * and drifting apart.
 */

/** Registry websites arrive without a scheme as often as with one. */
export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function registryStatusTone(status: string): BadgeTone {
  if (status === "AKTIVAN") return "success";
  if (status === "BRISAN") return "neutral";
  return "warning";
}

/**
 * The register's own status words. An unrecognised value is passed through
 * verbatim rather than guessed at, because it is official source data.
 */
export function registryStatusLabelKey(status: string): string | null {
  if (status === "AKTIVAN") return "organisations.status_active";
  if (status === "BRISAN") return "organisations.status_deleted";
  if (status === "PRESTANAK DJELOVANJA") return "organisations.status_ceased";
  return null;
}

/** Registry dates are plain calendar days; pin them to UTC so none shifts. */
export function formatRegistryDate(locale: string, value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
    new Date(`${value}T00:00:00Z`)
  );
}

export const REGISTRY_LINK_CLASSES =
  "rounded text-brand underline underline-offset-2 transition-colors hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function RegistryField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-sm font-medium text-ink-tertiary">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-base leading-6 text-ink">{value}</dd>
    </div>
  );
}
