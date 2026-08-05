"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Apple,
  Baby,
  Banknote,
  BedDouble,
  BookOpen,
  Check,
  Clock,
  Droplets,
  ExternalLink,
  Loader2,
  LocateFixed,
  MapPin,
  Pencil,
  Shirt,
  Sofa,
  Stethoscope,
} from "lucide-react";
import clsx from "clsx";
import type { DonationType, Locale } from "@/lib/types";
import type {
  PublicMapInstitution,
  PublicMapResponse,
} from "@/lib/location-map";
import {
  CATEGORY_CONFIG,
  DONATION_TYPES,
  categoryVars,
  getCategoryConfig,
} from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { Button, Card, Field, Input, buttonClasses } from "@/components/ui";

const TOTAL_STEPS = 3;

const DONATION_TYPE_ORDER = Object.keys(DONATION_TYPES) as DonationType[];

const DONATION_ICONS: Record<DonationType, LucideIcon> = {
  clothes: Shirt,
  food: Apple,
  hygiene: Droplets,
  toys_books: BookOpen,
  school_supplies: Pencil,
  furniture: Sofa,
  medical_supplies: Stethoscope,
  baby_items: Baby,
  blankets_bedding: BedDouble,
  money: Banknote,
  time: Clock,
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type RankedInstitution = PublicMapInstitution & { distanceKm: number };

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  // Browser-side reverse geocode via Nominatim (no key needed). Best-effort —
  // failures don't block the search; we just skip the address feedback.
  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?" +
      new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: "json",
        zoom: "16",
      }).toString();
    const res = await fetch(url, {
      headers: { "Accept-Language": "hr,en" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return typeof data.display_name === "string" ? data.display_name : null;
  } catch {
    return null;
  }
}

async function forwardGeocode(
  address: string
): Promise<{ lat: number; lng: number; label: string | null } | null> {
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({
        q: `${address}, Hrvatska`,
        format: "json",
        limit: "1",
        countrycodes: "hr",
      }).toString();
    const response = await fetch(url, {
      headers: { "Accept-Language": "hr,en" },
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;
    const row = rows[0];
    const lat = Number(row?.lat);
    const lng = Number(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      label: typeof row.display_name === "string" ? row.display_name : null,
    };
  } catch {
    return null;
  }
}

export function QuickStartWizard() {
  const t = useT();
  const { locale } = useLocale();
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Set<DonationType>>(new Set());
  const [geoLoading, setGeoLoading] = useState(false);
  // Errors are held as translation keys, not rendered strings, so switching
  // locale re-renders them in the new language.
  const [geoErrorKey, setGeoErrorKey] = useState<string | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [manualLocation, setManualLocation] = useState("");
  const [results, setResults] = useState<RankedInstitution[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchErrorKey, setFetchErrorKey] = useState<string | null>(null);

  // --- step motion -------------------------------------------------------
  // Steps used to cross-fade via a requestAnimationFrame opacity retrigger:
  // no direction, and the content swapped while invisible so the user could
  // not tell whether they had moved forward or back. The panel now travels
  // along the axis of navigation, and the card animates to its new height
  // instead of snapping.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [entering, setEntering] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  const goToStep = useCallback(
    (next: number) => {
      if (next !== step) setDirection(next > step ? 1 : -1);
      setStep(next);
      setEntering(true);
    },
    [step]
  );

  useEffect(() => {
    if (!entering) return;
    // Two frames on purpose: a single requestAnimationFrame can be coalesced
    // into the same paint as the state change, which is exactly why the old
    // crossfade sometimes did nothing at all.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntering(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [entering]);

  // Measure the live panel so the wrapper can transition between step heights.
  useEffect(() => {
    const node = panelRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPanelHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const toggleType = useCallback((type: DonationType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const requestLocation = useCallback(() => {
    setGeoErrorKey(null);
    setUserAddress(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoErrorKey("map_page.geo_unsupported");
      return;
    }
    setGeoLoading(true);
    // Same options as the Map page (src/app/map/page.tsx) so both surfaces
    // resolve to the same coordinates — most importantly maximumAge: 60000
    // which lets the browser reuse a recent fix rather than forcing a fresh
    // (and often less accurate) acquisition.
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLat(lat);
        setUserLng(lng);
        setGeoLoading(false);
        setResolvingAddress(true);
        const addr = await reverseGeocode(lat, lng);
        setUserAddress(addr);
        setResolvingAddress(false);
      },
      (err) => {
        setGeoLoading(false);
        setGeoErrorKey(
          err.code === err.PERMISSION_DENIED
            ? "quick_start.geo_denied"
            : err.code === err.TIMEOUT
            ? "quick_start.geo_timeout"
            : "quick_start.geo_failed"
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const step2Ready =
    (userLat !== null && userLng !== null) || manualLocation.trim().length > 0;

  const runSearch = useCallback(async () => {
    const types = [...selected];
    let lat = userLat;
    let lng = userLng;
    if (lat == null || lng == null) {
      const geocoded = await forwardGeocode(manualLocation.trim());
      if (!geocoded) {
        setFetchErrorKey("quick_start.geocode_failed");
        setResults([]);
        setFetchLoading(false);
        return;
      }
      lat = geocoded.lat;
      lng = geocoded.lng;
      setUserLat(lat);
      setUserLng(lng);
      setUserAddress(geocoded.label);
    }
    setFetchLoading(true);
    setFetchErrorKey(null);
    try {
      // Every request is spatially bounded and capped. The calls run in
      // parallel so selecting several donation types never downloads the
      // national catalogue or blocks types behind sequential round trips.
      const radiusDegrees = 0.22;
      const bbox = [
        lng - radiusDegrees,
        lat - radiusDegrees,
        lng + radiusDegrees,
        lat + radiusDegrees,
      ].join(",");
      const responses = await Promise.all(
        types.map(async (donationType) => {
          const params = new URLSearchParams({
            bbox,
            zoom: "12",
            donationType,
            limit: "50",
          });
          const response = await fetch(`/api/v1/map/institutions?${params}`);
          if (!response.ok) throw new Error("Institution search failed");
          return (await response.json()) as PublicMapResponse;
        })
      );
      const unique = new Map<string, PublicMapInstitution>();
      for (const response of responses) {
        for (const feature of response.features) {
          if (feature.kind === "institution") unique.set(feature.id, feature);
        }
      }
      const ranked: RankedInstitution[] = [...unique.values()].map((institution) => ({
        ...institution,
        distanceKm: distanceKm(
          lat!,
          lng!,
          institution.latitude,
          institution.longitude
        ),
      }));
      ranked.sort((a, b) => a.distanceKm - b.distanceKm);
      setResults(ranked.slice(0, 5));
    } catch {
      setFetchErrorKey("map_page.load_error");
      setResults([]);
    } finally {
      setFetchLoading(false);
    }
  }, [manualLocation, selected, userLat, userLng]);

  const stepDots = useMemo(
    () =>
      [1, 2, 3].map((n) => (
        <span
          key={n}
          className={clsx(
            "h-2.5 rounded-full transition-[width,background-color] duration-250 ease-out",
            step === n ? "w-6 bg-brand" : "w-2.5 bg-border-strong"
          )}
          aria-hidden
        />
      )),
    [step]
  );

  return (
    <Card padding="md" className="sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
          {t("quick_start.step_progress", { current: step, total: TOTAL_STEPS })}
        </p>
        <div className="flex items-center gap-2" aria-hidden>
          {stepDots}
        </div>
      </div>

      <div
        // `overflow-hidden` is what contains the sliding panel, and the 4px of
        // padding (pulled back out with negative margins) keeps it from also
        // clipping the focus ring of a tile sitting on the panel edge.
        className="-mx-1 -mb-1 mt-6 overflow-hidden p-1 transition-[height] duration-300 ease-out"
        style={panelHeight === null ? undefined : { height: panelHeight + 8 }}
      >
        <div
          ref={panelRef}
          className={clsx(
            "transition-[opacity,transform] duration-250 ease-out",
            entering
              ? clsx(
                  "opacity-0",
                  direction === 1
                    ? "motion-safe:translate-x-6"
                    : "motion-safe:-translate-x-6"
                )
              : "translate-x-0 opacity-100"
          )}
        >
          {step === 1 ? (
            <StepOne
              selected={selected}
              onToggle={toggleType}
              t={t}
              locale={locale}
            />
          ) : null}
          {step === 2 ? (
            <StepTwo
              geoLoading={geoLoading}
              geoErrorKey={geoErrorKey}
              onRequestLocation={requestLocation}
              manualLocation={manualLocation}
              onManualChange={setManualLocation}
              hasCoords={userLat !== null && userLng !== null}
              address={userAddress}
              resolvingAddress={resolvingAddress}
              t={t}
            />
          ) : null}
          {step === 3 ? (
            <StepThree
              loading={fetchLoading}
              errorKey={fetchErrorKey}
              results={results}
              t={t}
              locale={locale}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => goToStep(Math.max(1, step - 1))}
          disabled={step === 1}
        >
          {t("common.back")}
        </Button>
        {step < TOTAL_STEPS ? (
          <Button
            onClick={() => {
              if (step === 1 && selected.size === 0) return;
              if (step === 2 && !step2Ready) return;
              if (step === 2) {
                goToStep(3);
                void runSearch();
                return;
              }
              goToStep(step + 1);
            }}
            disabled={
              (step === 1 && selected.size === 0) ||
              (step === 2 && !step2Ready)
            }
          >
            {t("common.continue")}
          </Button>
        ) : (
          <Button
            onClick={() => {
              goToStep(1);
              setSelected(new Set());
              setUserLat(null);
              setUserLng(null);
              setUserAddress(null);
              setResolvingAddress(false);
              setManualLocation("");
              setResults([]);
              setFetchErrorKey(null);
              setGeoErrorKey(null);
            }}
          >
            {t("quick_start.start_over")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function StepOne({
  selected,
  onToggle,
  t,
  locale,
}: {
  selected: Set<DonationType>;
  onToggle: (type: DonationType) => void;
  t: Translate;
  locale: Locale;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">
        {t("quick_start.step1_title")}
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        {t("quick_start.step1_hint")}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DONATION_TYPE_ORDER.map((type) => {
          const Icon = DONATION_ICONS[type];
          const cfg = DONATION_TYPES[type];
          const isOn = selected.has(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={isOn}
              onClick={() => onToggle(type)}
              className={clsx(
                "relative flex items-center gap-3 rounded-card border p-4 text-left",
                "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out",
                "motion-safe:active:scale-[0.97]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                isOn
                  ? "border-brand bg-brand-soft shadow-raised"
                  : "border-border-subtle bg-surface-sunken hover:border-border-strong"
              )}
            >
              {isOn ? (
                <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                </span>
              ) : null}
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-raised text-brand shadow-raised">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="pr-8 text-base font-semibold text-ink">
                {locale === "hr" ? cfg.labelHr : cfg.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepTwo({
  geoLoading,
  geoErrorKey,
  onRequestLocation,
  manualLocation,
  onManualChange,
  hasCoords,
  address,
  resolvingAddress,
  t,
}: {
  geoLoading: boolean;
  geoErrorKey: string | null;
  onRequestLocation: () => void;
  manualLocation: string;
  onManualChange: (v: string) => void;
  hasCoords: boolean;
  address: string | null;
  resolvingAddress: boolean;
  t: Translate;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">
          {t("quick_start.step2_title")}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {t("quick_start.step2_privacy")}
        </p>
      </div>
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={onRequestLocation}
        loading={geoLoading}
        icon={
          hasCoords ? (
            <LocateFixed className="h-4 w-4" aria-hidden />
          ) : (
            <MapPin className="h-4 w-4" aria-hidden />
          )
        }
      >
        {geoLoading
          ? t("quick_start.locating")
          : hasCoords
          ? t("quick_start.relocate_me")
          : t("quick_start.use_my_location")}
      </Button>
      {geoErrorKey ? (
        <p
          className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-on-soft"
          role="alert"
        >
          {t(geoErrorKey)}
        </p>
      ) : null}
      {hasCoords ? (
        <div
          className="flex items-start gap-2 rounded-control bg-success-soft p-3 text-sm text-success-on-soft"
          role="status"
        >
          <LocateFixed className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("quick_start.found_you")}</p>
            {resolvingAddress ? (
              <p className="mt-0.5 inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {t("quick_start.resolving_address")}
              </p>
            ) : address ? (
              <p className="mt-0.5 break-words">{address}</p>
            ) : (
              <p className="mt-0.5 italic opacity-90">
                {t("quick_start.address_unresolved")}
              </p>
            )}
            <p className="mt-1 opacity-80">
              {t("quick_start.wrong_location", {
                action: t("quick_start.relocate_me"),
              })}
            </p>
          </div>
        </div>
      ) : null}
      <Field
        label={t("quick_start.manual_label")}
        hint={t("quick_start.manual_note")}
      >
        {(props) => (
          <Input
            {...props}
            type="text"
            value={manualLocation}
            onChange={(e) => onManualChange(e.target.value)}
            placeholder={t("quick_start.manual_placeholder")}
          />
        )}
      </Field>
    </div>
  );
}

function StepThree({
  loading,
  errorKey,
  results,
  t,
  locale,
}: {
  loading: boolean;
  errorKey: string | null;
  results: RankedInstitution[];
  t: Translate;
  locale: Locale;
}) {
  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 text-ink-secondary"
        role="status"
      >
        <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden />
        <p className="mt-3 text-base">{t("quick_start.searching")}</p>
      </div>
    );
  }

  if (errorKey) {
    return (
      <p
        className="rounded-control bg-danger-soft px-4 py-3 text-center text-sm text-danger-on-soft"
        role="alert"
      >
        {t(errorKey)}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">
        {t("quick_start.results_title")}
      </h2>
      {results.length === 0 ? (
        <p className="text-base text-ink-secondary">
          {t("quick_start.no_results")}
        </p>
      ) : (
        <ul className="space-y-3">
          {results.map((inst) => {
            const cat = getCategoryConfig(inst.category);
            const catStyle =
              inst.category && inst.category in CATEGORY_CONFIG
                ? categoryVars(inst.category)
                : undefined;
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${inst.latitude},${inst.longitude}`;
            const addressLine = inst.isLocationHidden
              ? inst.approximateArea ??
                inst.city ??
                t("map_ui.hidden_location")
              : [inst.address, inst.city].filter(Boolean).join(", ");
            return (
              <li
                key={inst.id}
                className="rounded-card border border-border-subtle bg-surface-sunken p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{inst.name}</p>
                    <p className="mt-0.5 text-sm font-medium text-brand">
                      {inst.distanceKm.toFixed(1)} km
                    </p>
                  </div>
                  <span
                    style={catStyle}
                    className="category-chip shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
                  >
                    {locale === "hr" ? cat.labelHr : cat.label}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-secondary">{addressLine}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!inst.isLocationHidden ? (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClasses({
                        variant: "secondary",
                        size: "sm",
                        className: "min-w-[7rem] grow",
                      })}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      {t("quick_start.directions")}
                    </a>
                  ) : null}
                  <a
                    href={`/institution/${inst.id}`}
                    className={buttonClasses({
                      size: "sm",
                      className: "min-w-[7rem] grow",
                    })}
                  >
                    {t("quick_start.view_details")}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
