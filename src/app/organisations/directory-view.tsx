"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  HeartHandshake,
  MapPin,
  Search,
} from "lucide-react";
import clsx from "clsx";
import { useLocale, useT } from "@/i18n/client";
import type {
  AssociationDirectoryItem,
  AssociationDirectoryResponse,
  EngagedDirectoryResponse,
} from "@/lib/association-registry";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  type BadgeTone,
} from "@/components/ui";

/** One status→tone map, shared with the detail page's treatment. */
/**
 * Both listings render the same cards and the same pager. Only the register
 * computes facets, so the shared shape carries just items and meta.
 */
type DirectoryListing = {
  items: AssociationDirectoryItem[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
};

function statusTone(status: string): BadgeTone {
  if (status === "AKTIVAN") return "success";
  if (status === "BRISAN") return "neutral";
  return "warning";
}

function statusLabel(status: string, t: ReturnType<typeof useT>) {
  if (status === "AKTIVAN") return t("organisations.status_active");
  if (status === "BRISAN") return t("organisations.status_deleted");
  if (status === "PRESTANAK DJELOVANJA") return t("organisations.status_ceased");
  return status;
}

/**
 * Matches AssociationCard's anatomy, status row, two-line name, four metadata
 * lines, footer link, rather than a flat block that then resizes on arrival.
 */
function AssociationCardSkeleton() {
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="mt-4 h-6 w-full" />
      <Skeleton className="mt-2 h-6 w-2/3" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-4" />
        ))}
      </div>
      <Skeleton className="mt-6 h-4 w-32" />
    </Card>
  );
}

export function DirectoryLoading() {
  return (
    <>
      <Skeleton className="h-64 rounded-card" />
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <AssociationCardSkeleton key={index} />
        ))}
      </div>
    </>
  );
}

function AssociationCard({ item }: { item: AssociationDirectoryItem }) {
  const t = useT();
  const { locale } = useLocale();
  const registered = item.registered_on
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${item.registered_on}T00:00:00Z`))
    : null;

  return (
    <li className="h-full">
      <Card as="article" className="flex h-full flex-col">
        {/* UDR_ID stays on the record (it's the link target below and the
            claim key) but isn't shown here; it's an internal registry
            identifier, not something a visitor needs to read off the card. */}
        {/* `self-start`: the old wrapper this replaced had `items-start` on
            its own flex row; without it the badge is a direct child of the
            card's `flex-col` and stretches to the full card width under the
            default `align-items: stretch`, turning the pill into a bar. */}
        <Badge tone={statusTone(item.status)} className="self-start">
          {statusLabel(item.status, t)}
        </Badge>
        {/* Registry names routinely run past 100 characters in a fixed-width
            grid cell, so the title is clamped rather than left to reflow. */}
        <h2 className="mt-4 text-lg font-semibold leading-snug text-ink">
          <Link
            href={`/organisations/${item.id}`}
            className="line-clamp-3 rounded-control underline-offset-2 transition-colors hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {item.name}
          </Link>
        </h2>
        {item.short_name ? (
          <p className="mt-1 line-clamp-1 text-sm text-ink-tertiary">
            {item.short_name}
          </p>
        ) : null}
        <div className="mt-4 space-y-2 text-sm text-ink-secondary">
          {item.address || item.county ? (
            <p className="flex gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              <span>{item.address || item.county}</span>
            </p>
          ) : null}
          {registered ? (
            <p>
              <span className="font-medium text-ink">{t("organisations.registered")}:</span>{" "}
              {registered}
            </p>
          ) : null}
          {item.registry_number ? (
            <p>
              <span className="font-medium text-ink">{t("organisations.registry_number")}:</span>{" "}
              {item.registry_number}
            </p>
          ) : null}
          <p>
            <span className="font-medium text-ink">OIB:</span>{" "}
            {item.oib || t("organisations.missing_oib")}
          </p>
        </div>
        <div className="mt-auto pt-5">
          <Link
            href={`/organisations/${item.id}`}
            className="inline-flex items-center gap-1.5 rounded-control text-sm font-semibold text-brand transition-colors hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {t("organisations.view_record")}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </li>
  );
}

/**
 * The official register, as one view of the merged Associations page.
 *
 * It no longer owns the page shell or the page title; the merged page does,
 * so switching views does not tear down and rebuild the heading.
 */
export function DirectoryView() {
  return (
    <Suspense fallback={<DirectoryLoading />}>
      <DirectoryExperience />
    </Suspense>
  );
}

function DirectoryExperience() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stableQuery = searchParams.toString();
  const [searchInput, setSearchInput] = useState(searchParams.get("q") || "");
  const [cityInput, setCityInput] = useState(searchParams.get("city") || "");
  const [data, setData] = useState<DirectoryListing | null>(null);
  // Facets describe the whole register. The onboarded listing does not compute
  // them, so the last set is kept and reused rather than emptying the selects
  // every time the toggle is flipped.
  const [facets, setFacets] = useState<AssociationDirectoryResponse["facets"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const onlyOnboarded = searchParams.get("onboarded") === "1";

  useEffect(() => {
    setSearchInput(searchParams.get("q") || "");
    setCityInput(searchParams.get("city") || "");
  }, [stableQuery, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(
      `/api/v1/organisations${onlyOnboarded ? "/engaged" : ""}${
        stableQuery ? `?${stableQuery}` : ""
      }`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<
          AssociationDirectoryResponse | EngagedDirectoryResponse
        >;
      })
      .then((response) => {
        setData({ items: response.items, meta: response.meta });
        if ("facets" in response) setFacets(response.facets);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(t("organisations.error"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [stableQuery, retry, t, onlyOnboarded]);

  function updateParams(changes: Record<string, string | null>, resetPage = true) {
    const params = new URLSearchParams(stableQuery);
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (resetPage) params.delete("page");
    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = searchInput.trim();
    if (query.length === 1) return;
    updateParams({ q: query || null, city: cityInput.trim() || null });
  }

  function clearAll() {
    setSearchInput("");
    setCityInput("");
    router.push(pathname, { scroll: false });
  }

  const resultSummary = useMemo(() => {
    if (!data) return "";
    return new Intl.NumberFormat(locale).format(data.meta.total);
  }, [data, locale]);

  const snapshotDate = facets?.snapshot?.metadata_modified
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(facets.snapshot.metadata_modified))
    : null;

  const filtersActive = stableQuery.length > 0;

  return (
    <>
      <p className="mb-6 text-sm text-ink-tertiary">
        <a
          href="https://data.gov.hr/ckan/hr/dataset/registar-udruga"
          target="_blank"
          rel="noreferrer"
          className="rounded font-medium text-brand underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {t("organisations.official_source")}
        </a>
        {snapshotDate ? ` · ${t("organisations.updated")} ${snapshotDate}` : ""}
      </p>

      <Card padding="md">
        <form onSubmit={submitSearch}>
          <div className="grid gap-4 lg:grid-cols-12">
            <Field
              className="lg:col-span-5"
              label={t("organisations.search_label")}
            >
              {(props) => (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-tertiary"
                    aria-hidden="true"
                  />
                  <Input
                    {...props}
                    interactive
                    className="pl-10"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={t("organisations.search_placeholder")}
                    minLength={2}
                    maxLength={100}
                  />
                </div>
              )}
            </Field>
            <Field className="lg:col-span-3" label={t("organisations.city")}>
              {(props) => (
                <Input
                  {...props}
                  interactive
                  value={cityInput}
                  onChange={(event) => setCityInput(event.target.value)}
                  placeholder={t("organisations.city_placeholder")}
                  maxLength={150}
                />
              )}
            </Field>
            <div className="flex items-end gap-2 lg:col-span-4">
              <Button type="submit">{t("organisations.search_submit")}</Button>
              <Button variant="secondary" onClick={clearAll}>
                {t("organisations.clear")}
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("organisations.county")}>
              {(props) => (
                <Select
                  {...props}
                  value={searchParams.get("county") || ""}
                  onChange={(event) => updateParams({ county: event.target.value || null })}
                >
                  <option value="">{t("organisations.all_counties")}</option>
                  {(facets?.counties || []).map((facet) => (
                    <option key={facet.value} value={facet.value}>
                      {facet.value} ({facet.count})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {onlyOnboarded ? null : (
            <Field label={t("organisations.form")}>
              {(props) => (
                <Select
                  {...props}
                  value={searchParams.get("form") || ""}
                  onChange={(event) => updateParams({ form: event.target.value || null })}
                >
                  <option value="">{t("organisations.all_forms")}</option>
                  {(facets?.forms || []).map((facet) => (
                    <option key={facet.value} value={facet.value}>
                      {facet.value} ({facet.count})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            )}
            {onlyOnboarded ? null : (
            <Field label={t("organisations.sort")}>
              {(props) => (
                <Select
                  {...props}
                  value={searchParams.get("sort") || "name_asc"}
                  onChange={(event) =>
                    updateParams({
                      sort: event.target.value === "name_asc" ? null : event.target.value,
                    })
                  }
                >
                  <option value="name_asc">{t("organisations.sort_name_asc")}</option>
                  <option value="name_desc">{t("organisations.sort_name_desc")}</option>
                  <option value="registered_desc">{t("organisations.sort_registered_desc")}</option>
                  <option value="registered_asc">{t("organisations.sort_registered_asc")}</option>
                  <option value="status_changed_desc">{t("organisations.sort_status_changed")}</option>
                </Select>
              )}
            </Field>
            )}
          </div>
          {/* The register is the national list; most of it is not reachable
              here. This narrows it to the organisations that actually hold an
              account, which is a different query rather than a client-side
              filter, so the count and the pager stay truthful. */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
            <button
              type="button"
              aria-pressed={onlyOnboarded}
              onClick={() => updateParams({ onboarded: onlyOnboarded ? null : "1" })}
              className={clsx(
                "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                onlyOnboarded
                  ? "border-brand bg-brand text-white"
                  : "border-border-subtle text-ink-secondary hover:bg-surface-sunken hover:text-ink"
              )}
            >
              <HeartHandshake className="h-4 w-4" aria-hidden />
              {t("organisations.only_onboarded")}
            </button>
            <p className="text-sm text-ink-tertiary">
              {t(
                onlyOnboarded
                  ? "organisations.only_onboarded_on"
                  : "organisations.only_onboarded_off"
              )}
            </p>
          </div>
        </form>
      </Card>

      <div className="mt-7 flex items-center justify-between gap-4">
        <p className="text-sm text-ink-secondary" aria-live="polite">
          {loading && !data
            ? t("organisations.loading")
            : t("organisations.result_count", { count: resultSummary })}
        </p>
        {data ? (
          <p className="text-sm text-ink-tertiary">
            {t("organisations.page", { current: data.meta.page, total: data.meta.pageCount })}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mt-5" role="alert">
          <EmptyState
            icon={<AlertTriangle className="h-10 w-10" aria-hidden="true" />}
            title={error}
            action={
              <Button
                variant="secondary"
                onClick={() => setRetry((value) => value + 1)}
                loading={loading}
              >
                {t("organisations.retry")}
              </Button>
            }
          />
        </div>
      ) : null}

      {!error && data?.items.length === 0 && !loading ? (
        <EmptyState
          className="mt-5"
          icon={<Building2 className="h-10 w-10" aria-hidden="true" />}
          title={t("organisations.no_results")}
          action={
            filtersActive ? (
              <Button variant="secondary" onClick={clearAll}>
                {t("organisations.clear")}
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {data?.items.length ? (
        <ul
          className={clsx(
            "mt-5 grid gap-4 transition-opacity duration-150 ease-out md:grid-cols-2 xl:grid-cols-3",
            loading && "opacity-60"
          )}
          aria-busy={loading}
        >
          {data.items.map((item) => (
            <AssociationCard key={item.id} item={item} />
          ))}
        </ul>
      ) : null}

      {data && data.meta.pageCount > 1 ? (
        <nav
          className="mt-8 flex items-center justify-center gap-3"
          aria-label={t("organisations.pagination")}
        >
          <Button
            variant="secondary"
            disabled={data.meta.page <= 1 || loading}
            onClick={() => updateParams({ page: String(data.meta.page - 1) }, false)}
            icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          >
            {t("organisations.previous")}
          </Button>
          <span className="min-w-24 text-center text-sm tabular-nums text-ink-secondary">
            {data.meta.page} / {data.meta.pageCount}
          </span>
          <Button
            variant="secondary"
            disabled={data.meta.page >= data.meta.pageCount || loading}
            onClick={() => updateParams({ page: String(data.meta.page + 1) }, false)}
          >
            {t("organisations.next")}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
    </>
  );
}
