"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronLeft, ChevronRight, Database, MapPin, Search } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import type {
  AssociationDirectoryItem,
  AssociationDirectoryResponse,
} from "@/lib/association-registry";

function statusClass(status: string) {
  if (status === "AKTIVAN") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (status === "BRISAN") return "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
}

function DirectoryLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="h-10 w-80 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
      <div className="mt-8 h-40 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-900" />
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-52 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-900" />
        ))}
      </div>
    </div>
  );
}

function statusLabel(status: string, t: ReturnType<typeof useT>) {
  if (status === "AKTIVAN") return t("organisations.status_active");
  if (status === "BRISAN") return t("organisations.status_deleted");
  if (status === "PRESTANAK DJELOVANJA") return t("organisations.status_ceased");
  return status;
}

function AssociationCard({ item }: { item: AssociationDirectoryItem }) {
  const t = useT();
  const { locale } = useLocale();
  const registered = item.registered_on
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${item.registered_on}T00:00:00Z`))
    : null;

  return (
    <li className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(item.status)}`}>
          {statusLabel(item.status, t)}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">UDR_ID {item.id}</span>
      </div>
      <h2 className="mt-4 text-lg font-semibold leading-snug text-gray-950 dark:text-white">
        <Link href={`/organisations/${item.id}`} className="hover:text-red-600 dark:hover:text-red-400">
          {item.name}
        </Link>
      </h2>
      {item.short_name ? <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.short_name}</p> : null}
      <div className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300">
        {item.address || item.county ? (
          <p className="flex gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
            <span>{item.address || item.county}</span>
          </p>
        ) : null}
        {registered ? (
          <p><span className="font-medium">{t("organisations.registered")}:</span> {registered}</p>
        ) : null}
        {item.registry_number ? (
          <p><span className="font-medium">{t("organisations.registry_number")}:</span> {item.registry_number}</p>
        ) : null}
        <p><span className="font-medium">OIB:</span> {item.oib || t("organisations.missing_oib")}</p>
      </div>
      <div className="mt-auto pt-5">
        <Link
          href={`/organisations/${item.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700 dark:text-red-400"
        >
          {t("organisations.view_record")} <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export default function OrganisationsPage() {
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
  const [data, setData] = useState<AssociationDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setSearchInput(searchParams.get("q") || "");
    setCityInput(searchParams.get("city") || "");
  }, [stableQuery, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/v1/organisations${stableQuery ? `?${stableQuery}` : ""}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<AssociationDirectoryResponse>;
      })
      .then(setData)
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(t("organisations.error"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [stableQuery, retry, t]);

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

  const resultSummary = useMemo(() => {
    if (!data) return "";
    return new Intl.NumberFormat(locale).format(data.meta.total);
  }, [data, locale]);

  const snapshotDate = data?.facets.snapshot?.metadata_modified
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(data.facets.snapshot.metadata_modified))
    : null;

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-950">
      <section className="border-b border-red-100 bg-gradient-to-br from-red-50 via-white to-amber-50 dark:border-red-950 dark:from-red-950/30 dark:via-gray-950 dark:to-amber-950/20">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex max-w-4xl items-start gap-4">
            <span className="rounded-2xl bg-red-100 p-3 text-red-600 dark:bg-red-950 dark:text-red-300">
              <Database className="h-7 w-7" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-950 dark:text-white sm:text-4xl">
                {t("organisations.title")}
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-gray-700 dark:text-gray-300">
                {t("organisations.subtitle")}
              </p>
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                <a
                  href="https://data.gov.hr/ckan/hr/dataset/registar-udruga"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-red-600 underline underline-offset-2 dark:text-red-400"
                >
                  {t("organisations.official_source")}
                </a>
                {snapshotDate ? ` · ${t("organisations.updated")} ${snapshotDate}` : ""}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <form onSubmit={submitSearch} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="grid gap-4 lg:grid-cols-12">
            <label className="lg:col-span-5">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{t("organisations.search_label")}</span>
              <span className="mt-1.5 flex rounded-xl border border-gray-300 bg-white focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-100 dark:border-gray-700 dark:bg-gray-950 dark:focus-within:ring-red-950">
                <Search className="ml-3 mt-3 h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={t("organisations.search_placeholder")}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
                  minLength={2}
                  maxLength={100}
                />
              </span>
            </label>
            <label className="lg:col-span-3">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{t("organisations.city")}</span>
              <input
                value={cityInput}
                onChange={(event) => setCityInput(event.target.value)}
                placeholder={t("organisations.city_placeholder")}
                className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-950"
                maxLength={150}
              />
            </label>
            <div className="flex items-end gap-2 lg:col-span-4">
              <button type="submit" className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
                {t("organisations.search_submit")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setCityInput("");
                  router.push(pathname, { scroll: false });
                }}
                className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                {t("organisations.clear")}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="text-sm font-medium">{t("organisations.status")}</span>
              <select
                value={searchParams.get("status") || ""}
                onChange={(event) => updateParams({ status: event.target.value || null })}
                className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="">{t("organisations.all_statuses")}</option>
                {(data?.facets.statuses || []).map((facet) => (
                  <option key={facet.value} value={facet.value}>{statusLabel(facet.value, t)} ({facet.count})</option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-sm font-medium">{t("organisations.county")}</span>
              <select
                value={searchParams.get("county") || ""}
                onChange={(event) => updateParams({ county: event.target.value || null })}
                className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="">{t("organisations.all_counties")}</option>
                {(data?.facets.counties || []).map((facet) => (
                  <option key={facet.value} value={facet.value}>{facet.value} ({facet.count})</option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-sm font-medium">{t("organisations.form")}</span>
              <select
                value={searchParams.get("form") || ""}
                onChange={(event) => updateParams({ form: event.target.value || null })}
                className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="">{t("organisations.all_forms")}</option>
                {(data?.facets.forms || []).map((facet) => (
                  <option key={facet.value} value={facet.value}>{facet.value} ({facet.count})</option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-sm font-medium">{t("organisations.sort")}</span>
              <select
                value={searchParams.get("sort") || "name_asc"}
                onChange={(event) => updateParams({ sort: event.target.value === "name_asc" ? null : event.target.value })}
                className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="name_asc">{t("organisations.sort_name_asc")}</option>
                <option value="name_desc">{t("organisations.sort_name_desc")}</option>
                <option value="registered_desc">{t("organisations.sort_registered_desc")}</option>
                <option value="registered_asc">{t("organisations.sort_registered_asc")}</option>
                <option value="status_changed_desc">{t("organisations.sort_status_changed")}</option>
              </select>
            </label>
          </div>
        </form>

        <div className="mt-7 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
            {loading && !data ? t("organisations.loading") : t("organisations.result_count", { count: resultSummary })}
          </p>
          {data ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("organisations.page", { current: data.meta.page, total: data.meta.pageCount })}
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <p>{error}</p>
            <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 font-semibold underline">
              {t("organisations.retry")}
            </button>
          </div>
        ) : null}

        {!error && data?.items.length === 0 && !loading ? (
          <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
            <Building2 className="mx-auto h-9 w-9 text-gray-400" aria-hidden="true" />
            <p className="mt-3 text-gray-700 dark:text-gray-300">{t("organisations.no_results")}</p>
          </div>
        ) : null}

        {data?.items.length ? (
          <ul className={`mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {data.items.map((item) => <AssociationCard key={item.id} item={item} />)}
          </ul>
        ) : null}

        {data && data.meta.pageCount > 1 ? (
          <nav className="mt-8 flex items-center justify-center gap-3" aria-label={t("organisations.pagination")}>
            <button
              type="button"
              disabled={data.meta.page <= 1 || loading}
              onClick={() => updateParams({ page: String(data.meta.page - 1) }, false)}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t("organisations.previous")}
            </button>
            <span className="min-w-24 text-center text-sm text-gray-600 dark:text-gray-400">
              {data.meta.page} / {data.meta.pageCount}
            </span>
            <button
              type="button"
              disabled={data.meta.page >= data.meta.pageCount || loading}
              onClick={() => updateParams({ page: String(data.meta.page + 1) }, false)}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700"
            >
              {t("organisations.next")} <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
