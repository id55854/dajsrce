"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Phone,
  Shirt,
  Sofa,
  Stethoscope,
} from "lucide-react";
import clsx from "clsx";
import type { DonationType, Institution } from "@/lib/types";
import { DONATION_TYPES, ZAGREB_CENTER, getCategoryConfig } from "@/lib/constants";

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

type RankedInstitution = Institution & { distanceKm: number };

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

export function QuickStartWizard() {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Set<DonationType>>(new Set());
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [usedZagrebFallback, setUsedZagrebFallback] = useState(false);
  const [manualLocation, setManualLocation] = useState("");
  const [results, setResults] = useState<RankedInstitution[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [panelVisible, setPanelVisible] = useState(true);

  useEffect(() => {
    setPanelVisible(false);
    const id = requestAnimationFrame(() => setPanelVisible(true));
    return () => cancelAnimationFrame(id);
  }, [step]);

  const toggleType = useCallback((t: DonationType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const requestLocation = useCallback(() => {
    setGeoError(null);
    setUserAddress(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Geolocation is not supported in this browser.");
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
        setUsedZagrebFallback(false);
        setGeoLoading(false);
        setResolvingAddress(true);
        const addr = await reverseGeocode(lat, lng);
        setUserAddress(addr);
        setResolvingAddress(false);
      },
      (err) => {
        setGeoLoading(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enable it in your browser settings or enter a neighborhood below."
            : err.code === err.TIMEOUT
            ? "Locating took too long. Try again or enter a neighborhood below."
            : "Unable to get location. Check permissions or enter a neighborhood."
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
    let fallback = false;
    if (lat == null || lng == null) {
      lat = ZAGREB_CENTER[0];
      lng = ZAGREB_CENTER[1];
      fallback = true;
    }
    setUsedZagrebFallback(fallback);
    setFetchLoading(true);
    setFetchError(null);
    try {
      // One fetch for the full institution catalogue, filter client-side.
      // Cheaper than N round-trips and lets us match orgs that accept ANY
      // of the selected types (the previous approach already deduped via a
      // Map but did N HTTP calls; the union of accepted_types is the same).
      const res = await fetch("/api/institutions");
      if (!res.ok) throw new Error(await res.text());
      const { institutions } = (await res.json()) as { institutions: Institution[] };

      const wanted = new Set(types);
      const matching = institutions.filter((inst) =>
        (inst.accepts_donations ?? []).some((t) => wanted.has(t as DonationType))
      );

      const ranked: RankedInstitution[] = matching.map((inst) => ({
        ...inst,
        distanceKm: distanceKm(lat!, lng!, inst.lat, inst.lng),
      }));
      ranked.sort((a, b) => a.distanceKm - b.distanceKm);
      setResults(ranked.slice(0, 5));
    } catch {
      setFetchError("Failed to load institutions. Please try again.");
      setResults([]);
    } finally {
      setFetchLoading(false);
    }
  }, [selected, userLat, userLng]);

  const stepDots = useMemo(
    () =>
      [1, 2, 3].map((n) => (
        <span
          key={n}
          className={clsx(
            "h-2.5 w-2.5 rounded-full transition-colors",
            step === n ? "bg-red-500" : "bg-gray-200"
          )}
          aria-hidden
        />
      )),
    [step]
  );

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="font-[family-name:var(--font-dm-sans)] text-xl font-bold text-gray-900">
        What can I give?
      </h2>
      <div className="mt-4 flex justify-center gap-2" aria-hidden>
        {stepDots}
      </div>

      <div
        className={clsx(
          "mt-6 transition-opacity duration-300 ease-out",
          panelVisible ? "opacity-100" : "opacity-0"
        )}
      >
        {step === 1 ? (
          <StepOne selected={selected} onToggle={toggleType} />
        ) : null}
        {step === 2 ? (
          <StepTwo
            geoLoading={geoLoading}
            geoError={geoError}
            onRequestLocation={requestLocation}
            manualLocation={manualLocation}
            onManualChange={setManualLocation}
            hasCoords={userLat !== null && userLng !== null}
            address={userAddress}
            resolvingAddress={resolvingAddress}
          />
        ) : null}
        {step === 3 ? (
          <StepThree
            loading={fetchLoading}
            error={fetchError}
            results={results}
            usedZagrebFallback={usedZagrebFallback}
          />
        ) : null}
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-40"
        >
          Back
        </button>
        {step < 3 ? (
          <button
            type="button"
            onClick={() => {
              if (step === 1 && selected.size === 0) return;
              if (step === 2 && !step2Ready) return;
              if (step === 2) {
                setStep(3);
                void runSearch();
                return;
              }
              setStep((s) => s + 1);
            }}
            disabled={
              (step === 1 && selected.size === 0) ||
              (step === 2 && !step2Ready)
            }
            className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600 disabled:pointer-events-none disabled:opacity-40"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setStep(1);
              setSelected(new Set());
              setUserLat(null);
              setUserLng(null);
              setUserAddress(null);
              setResolvingAddress(false);
              setManualLocation("");
              setResults([]);
              setFetchError(null);
              setUsedZagrebFallback(false);
            }}
            className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600"
          >
            Start over
          </button>
        )}
      </div>
    </div>
  );
}

function StepOne({
  selected,
  onToggle,
}: {
  selected: Set<DonationType>;
  onToggle: (t: DonationType) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-800">What do you have?</p>
      <p className="mt-1 text-xs text-gray-500">
        Select one or more categories.
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
              onClick={() => onToggle(type)}
              className={clsx(
                "relative flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all",
                isOn
                  ? "border-red-500 bg-red-50/60 shadow-sm"
                  : "border-gray-100 bg-gray-50/50 hover:border-gray-200"
              )}
            >
              {isOn ? (
                <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
              ) : null}
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-red-500 shadow-sm">
                <Icon className="h-5 w-5" />
              </span>
              <span className="pr-8 font-[family-name:var(--font-dm-sans)] text-sm font-semibold text-gray-900">
                {cfg.label}
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
  geoError,
  onRequestLocation,
  manualLocation,
  onManualChange,
  hasCoords,
  address,
  resolvingAddress,
}: {
  geoLoading: boolean;
  geoError: string | null;
  onRequestLocation: () => void;
  manualLocation: string;
  onManualChange: (v: string) => void;
  hasCoords: boolean;
  address: string | null;
  resolvingAddress: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-800">Where are you?</p>
      <p className="text-xs text-gray-500">
        We only use your location to calculate distances.
      </p>
      <button
        type="button"
        onClick={onRequestLocation}
        disabled={geoLoading}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-red-100 bg-red-50/80 px-4 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60"
      >
        {geoLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : hasCoords ? (
          <LocateFixed className="h-4 w-4" />
        ) : (
          <MapPin className="h-4 w-4" />
        )}
        {geoLoading
          ? "Getting location…"
          : hasCoords
          ? "Re-locate me"
          : "Use my location"}
      </button>
      {geoError ? (
        <p className="text-sm text-amber-700" role="alert">
          {geoError}
        </p>
      ) : null}
      {hasCoords ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
          role="status"
        >
          <LocateFixed className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">We found you here:</p>
            {resolvingAddress ? (
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-300">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Resolving address…
              </p>
            ) : address ? (
              <p className="mt-0.5 break-words text-xs">{address}</p>
            ) : (
              <p className="mt-0.5 text-xs italic text-emerald-800/80 dark:text-emerald-300/80">
                Address could not be resolved, but coordinates are saved.
              </p>
            )}
            <p className="mt-1 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
              Wrong location? Click <span className="font-semibold">Re-locate me</span> above or type a neighborhood below.
            </p>
          </div>
        </div>
      ) : null}
      <div>
        <label
          htmlFor="wizard-neighborhood"
          className="text-xs font-medium uppercase tracking-wide text-gray-500"
        >
          Or enter a neighborhood / address
        </label>
        <input
          id="wizard-neighborhood"
          type="text"
          value={manualLocation}
          onChange={(e) => onManualChange(e.target.value)}
          placeholder="e.g. Trešnjevka, Ilica 12…"
          className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none ring-red-500/30 transition-shadow focus:border-red-400 focus:ring-2"
        />
        <p className="mt-1 text-xs text-gray-500">
          Without GPS, distances are measured from Zagreb city center.
        </p>
      </div>
    </div>
  );
}

function StepThree({
  loading,
  error,
  results,
  usedZagrebFallback,
}: {
  loading: boolean;
  error: string | null;
  results: RankedInstitution[];
  usedZagrebFallback: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
        <p className="mt-3 text-sm">Searching for nearby institutions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-center text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-800">Nearest institutions</p>
      {usedZagrebFallback ? (
        <p className="text-xs text-gray-500">
          Distances are approximate (Zagreb city center).
        </p>
      ) : null}
      {results.length === 0 ? (
        <p className="text-sm text-gray-600">
          No institutions match your selection. Try other categories.
        </p>
      ) : (
        <ul className="space-y-3">
          {results.map((inst) => {
            const cat = getCategoryConfig(inst.category);
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${inst.lat},${inst.lng}`;
            const tel =
              inst.phone != null
                ? `tel:${inst.phone.replace(/\s/g, "")}`
                : null;
            const addressLine = inst.is_location_hidden
              ? inst.approximate_area ?? "Hidden location"
              : `${inst.address}, ${inst.city}`;
            return (
              <li
                key={inst.id}
                className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-[family-name:var(--font-dm-sans)] font-semibold text-gray-900">
                      {inst.name}
                    </p>
                    <p className="mt-0.5 text-sm text-red-600">
                      {inst.distanceKm.toFixed(1)} km
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{ color: cat.color, backgroundColor: cat.bgColor }}
                  >
                    {cat.label}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{addressLine}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-1 min-w-[6rem] items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Directions
                  </a>
                  {tel ? (
                    <a
                      href={tel}
                      className="inline-flex flex-1 min-w-[6rem] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
