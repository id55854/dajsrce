/**
 * Which background tiles the map draws, decided once from public config.
 *
 * CARTO's basemaps (the light "Voyager" and dark styles the map was designed
 * on) now watermark every tile served without an API key with "API KEY
 * REQUIRED". The key is free for non-profits and is a plain query parameter,
 * so it is public by nature and lives in `NEXT_PUBLIC_CARTO_API_KEY`.
 *
 * Without a key the map falls back to OpenStreetMap's own raster tiles: no
 * account, no key, no watermark, but one light style only (dark mode becomes
 * a CSS filter, see `.map-tiles-dark`), no retina variant, and a best-effort
 * server whose usage policy tolerates moderate traffic. That fallback is
 * meant to keep a fresh clone and a short outage usable, not to be the
 * production basemap.
 */

export type BasemapProvider = "carto" | "openstreetmap";

export type BasemapLayer = {
  provider: BasemapProvider;
  url: string;
  /** Leaflet `subdomains` option; empty when the host has none. */
  subdomains: string;
  /** Attribution HTML for the basemap only; data attributions are appended. */
  attribution: string;
  /** Class Leaflet puts on the tile container; used for the dark filter. */
  className: string;
  maxZoom: number;
};

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

/** Accepts CARTO's key shape; anything else is treated as "no key". */
const CARTO_KEY = /^[A-Za-z0-9_-]{16,256}$/;

export function normalizeCartoApiKey(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  return value && CARTO_KEY.test(value) ? value : null;
}

export function basemapLayer(dark: boolean, cartoApiKey: string | null): BasemapLayer {
  if (cartoApiKey) {
    const style = dark ? "dark_all" : "rastertiles/voyager";
    return {
      provider: "carto",
      url: `https://basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoApiKey)}`,
      subdomains: "",
      attribution: CARTO_ATTRIBUTION,
      className: "",
      maxZoom: 20,
    };
  }
  return {
    provider: "openstreetmap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: "",
    attribution: OSM_ATTRIBUTION,
    className: dark ? "map-tiles-dark" : "",
    maxZoom: 19,
  };
}
