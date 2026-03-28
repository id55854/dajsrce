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
  MapPin,
  Pencil,
  Phone,
  Shirt,
  Sofa,
  Stethoscope,
} from "lucide-react";
import clsx from "clsx";
import type { DonationType, Institution } from "@/lib/types";
import { CATEGORY_CONFIG, DONATION_TYPES, ZAGREB_CENTER } from "@/lib/constants";

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

export function QuickStartWizard() {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Set<DonationType>>(new Set());
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
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
    if (!navigator.geolocation) {
      setGeoError("Geolokacija nije podržana u ovom pregledniku.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLat(pos.coords.latitude);
        setUserLng(pos.coords.longitude);
        setUsedZagrebFallback(false);
        setGeoLoading(false);
      },
      () => {
        setGeoLoading(false);
        setGeoError("Nismo uspjeli dohvatiti lokaciju. Provjerite dozvole ili unesite kvart.");
      },
      { enableHighAccuracy: true, timeout: 12_000 }
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
      const responses = await Promise.all(
        types.map((donation_type) =>
          fetch(
            `/api/institutions?donation_type=${encodeURIComponent(donation_type)}`
          ).then(async (r) => {
            if (!r.ok) throw new Error(await r.text());
            return r.json() as Promise<{ institutions: Institution[] }>;
          })
        )
      );
      const byId = new Map<string, Institution>();
      for (const { institutions } of responses) {
        for (const inst of institutions) {
          byId.set(inst.id, inst);
        }
      }
      const ranked: RankedInstitution[] = [...byId.values()].map((inst) => ({
        ...inst,
        distanceKm: distanceKm(lat!, lng!, inst.lat, inst.lng),
      }));
      ranked.sort((a, b) => a.distanceKm - b.distanceKm);
      setResults(ranked.slice(0, 5));
    } catch {
      setFetchError("Učitavanje ustanova nije uspjelo. Pokušajte ponovno.");
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
        Što mogu dati?
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
          Natrag
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
            Dalje
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setStep(1);
              setSelected(new Set());
              setUserLat(null);
              setUserLng(null);
              setManualLocation("");
              setResults([]);
              setFetchError(null);
              setUsedZagrebFallback(false);
            }}
            className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600"
          >
            Počni ispočetka
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
      <p className="text-sm font-medium text-gray-800">Što imate?</p>
      <p className="mt-1 text-xs text-gray-500">
        Odaberite jednu ili više kategorija.
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
                {cfg.labelHr}
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
}: {
  geoLoading: boolean;
  geoError: string | null;
  onRequestLocation: () => void;
  manualLocation: string;
  onManualChange: (v: string) => void;
  hasCoords: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-800">Gdje ste?</p>
      <p className="text-xs text-gray-500">
        Koristimo lokaciju samo za izračun udaljenosti.
      </p>
      <button
        type="button"
        onClick={onRequestLocation}
        disabled={geoLoading}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-red-100 bg-red-50/80 px-4 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60"
      >
        <MapPin className="h-4 w-4" />
        {geoLoading ? "Dohvaćam lokaciju…" : "Koristi moju lokaciju"}
      </button>
      {geoError ? (
        <p className="text-sm text-amber-700" role="alert">
          {geoError}
        </p>
      ) : null}
      {hasCoords ? (
        <p className="text-sm text-emerald-700">Lokacija je spremljena.</p>
      ) : null}
      <div>
        <label
          htmlFor="wizard-neighborhood"
          className="text-xs font-medium uppercase tracking-wide text-gray-500"
        >
          Ili unesite kvart / adresu
        </label>
        <input
          id="wizard-neighborhood"
          type="text"
          value={manualLocation}
          onChange={(e) => onManualChange(e.target.value)}
          placeholder="npr. Trešnjevka, Ilica 12…"
          className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none ring-red-500/30 transition-shadow focus:border-red-400 focus:ring-2"
        />
        <p className="mt-1 text-xs text-gray-500">
          Bez GPS-a udaljenost se računa od središta Zagreba.
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
        <p className="mt-3 text-sm">Tražim najbliže ustanove…</p>
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
      <p className="text-sm font-medium text-gray-800">Najbliže ustanove</p>
      {usedZagrebFallback ? (
        <p className="text-xs text-gray-500">
          Udaljenosti su približne (središte Zagreba).
        </p>
      ) : null}
      {results.length === 0 ? (
        <p className="text-sm text-gray-600">
          Nema ustanova koje odgovaraju odabiru. Pokušajte druge kategorije.
        </p>
      ) : (
        <ul className="space-y-3">
          {results.map((inst) => {
            const cat = CATEGORY_CONFIG[inst.category];
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${inst.lat},${inst.lng}`;
            const tel =
              inst.phone != null
                ? `tel:${inst.phone.replace(/\s/g, "")}`
                : null;
            const addressLine = inst.is_location_hidden
              ? inst.approximate_area ?? "Lokacija skrivena"
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
                    {cat.labelHr}
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
                    Upute
                  </a>
                  {tel ? (
                    <a
                      href={tel}
                      className="inline-flex flex-1 min-w-[6rem] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Nazovi
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
