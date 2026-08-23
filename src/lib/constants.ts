import type { CSSProperties } from "react";
import type { InstitutionCategory, DonationType } from "./types";

export const CATEGORY_CONFIG: Record<
  InstitutionCategory,
  {
    label: string;
    labelHr: string;
    color: string;
    bgColor: string;
    icon: string;
  }
> = {
  association: {
    label: "Association",
    labelHr: "Udruga",
    color: "#475569",
    bgColor: "#f1f5f9",
    icon: "Landmark",
  },
  homeless_shelter: {
    label: "Homeless shelter",
    labelHr: "Prihvatilište / prenoćište",
    color: "#f97316",
    bgColor: "#fff7ed",
    icon: "Bed",
  },
  soup_kitchen: {
    label: "Soup kitchen",
    labelHr: "Pučka kuhinja",
    color: "#ef4444",
    bgColor: "#fef2f2",
    icon: "UtensilsCrossed",
  },
  children_home: {
    label: "Children's home",
    labelHr: "Dom za djecu",
    color: "#3b82f6",
    bgColor: "#eff6ff",
    icon: "Baby",
  },
  caritas: {
    label: "Caritas & church services",
    labelHr: "Caritas / crkvene službe",
    color: "#8b5cf6",
    bgColor: "#f5f3ff",
    icon: "Heart",
  },
  disability_support: {
    label: "Disability support",
    labelHr: "Podrška za osobe s invaliditetom",
    color: "#14b8a6",
    bgColor: "#f0fdfa",
    icon: "Accessibility",
  },
  domestic_violence: {
    label: "Domestic violence shelter",
    labelHr: "Sigurna kuća",
    color: "#ec4899",
    bgColor: "#fdf2f8",
    icon: "Shield",
  },
  elderly_care: {
    label: "Elderly care",
    labelHr: "Skrb za starije",
    color: "#22c55e",
    bgColor: "#f0fdf4",
    icon: "HeartHandshake",
  },
  social_welfare: {
    label: "Social welfare",
    labelHr: "Socijalna skrb",
    color: "#6b7280",
    bgColor: "#f9fafb",
    icon: "Building2",
  },
  student_housing: {
    label: "Student housing support",
    labelHr: "Smještaj za studente",
    color: "#6366f1",
    bgColor: "#eef2ff",
    icon: "GraduationCap",
  },
  mental_health: {
    label: "Mental health & addiction",
    labelHr: "Mentalno zdravlje i ovisnosti",
    color: "#0ea5e9",
    bgColor: "#f0f9ff",
    icon: "Brain",
  },
  refugee_migrant_support: {
    label: "Refugee & migrant support",
    labelHr: "Podrška izbjeglicama i migrantima",
    color: "#a855f7",
    bgColor: "#faf5ff",
    icon: "Globe2",
  },
  medical_patient_support: {
    label: "Patient & medical support",
    labelHr: "Udruge pacijenata i bolesnika",
    color: "#0d9488",
    bgColor: "#f0fdfa",
    icon: "HeartPulse",
  },
};

/**
 * Publishes a category's hue as the `--cat` custom property.
 *
 * Pair with the `category-chip` / `category-tint` / `category-accent` classes
 * in globals.css, which derive the tint and ink by mixing this hue against the
 * theme's surface and ink tokens. Applying `CATEGORY_CONFIG[c].bgColor`
 * directly is what made category chips render near-white on dark surfaces, so
 * prefer this everywhere the colour reaches the DOM.
 */
export function categoryVars(category: InstitutionCategory): CSSProperties {
  return { "--cat": CATEGORY_CONFIG[category].color } as CSSProperties;
}

export const DONATION_TYPES: Record<
  DonationType,
  { label: string; labelHr: string; icon: string }
> = {
  clothes: { label: "Clothes", labelHr: "Odjeća i obuća", icon: "Shirt" },
  food: { label: "Food", labelHr: "Hrana", icon: "Apple" },
  hygiene: {
    label: "Hygiene products",
    labelHr: "Higijenske potrepštine",
    icon: "Droplets",
  },
  toys_books: {
    label: "Toys & books",
    labelHr: "Igračke i knjige",
    icon: "BookOpen",
  },
  school_supplies: {
    label: "School supplies",
    labelHr: "Školski pribor",
    icon: "Pencil",
  },
  furniture: {
    label: "Furniture & appliances",
    labelHr: "Namještaj i aparati",
    icon: "Sofa",
  },
  medical_supplies: {
    label: "Medical supplies",
    labelHr: "Medicinski materijal",
    icon: "Stethoscope",
  },
  baby_items: {
    label: "Baby items",
    labelHr: "Dječja oprema",
    icon: "Baby",
  },
  blankets_bedding: {
    label: "Blankets & bedding",
    labelHr: "Deke i posteljina",
    icon: "BedDouble",
  },
  money: {
    label: "Money (via institution)",
    labelHr: "Novac (putem ustanove)",
    icon: "Banknote",
  },
  time: { label: "Volunteering", labelHr: "Volontiranje", icon: "Clock" },
};

// Fallback config used when an institution has a category we don't recognise
// (e.g. a row imported with a category newer than the deployed front-end).
// Prevents undefined-property crashes when reading CATEGORY_CONFIG[cat].
export const FALLBACK_CATEGORY_CONFIG = {
  label: "Other",
  labelHr: "Ostalo",
  color: "#6b7280",
  bgColor: "#f9fafb",
  icon: "Building2",
};

export function getCategoryConfig(cat: string | null | undefined) {
  if (!cat) return FALLBACK_CATEGORY_CONFIG;
  return (CATEGORY_CONFIG as Record<string, typeof FALLBACK_CATEGORY_CONFIG>)[cat] ?? FALLBACK_CATEGORY_CONFIG;
}

export const ZAGREB_CENTER: [number, number] = [45.8131, 15.9775];
export const DEFAULT_ZOOM = 13;

export const SHIPMENT_METHOD_LABELS: Record<string, { label: string; labelHr: string }> = {
  self_dropoff: { label: "Self drop-off", labelHr: "Osobno dostavljanje" },
  courier_pickup: { label: "Courier pickup", labelHr: "Dolazak kurira" },
  parcel_locker: { label: "Parcel locker", labelHr: "Paketomat" },
  ngo_pickup: { label: "NGO pickup", labelHr: "Preuzimanje od NGO-a" },
  third_party_partner: { label: "Third-party partner", labelHr: "Partnerski prijevoznik" },
};
