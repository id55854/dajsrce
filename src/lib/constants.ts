import { InstitutionCategory, DonationType } from "./types";

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
};

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

export const ZAGREB_CENTER: [number, number] = [45.8131, 15.9775];
export const DEFAULT_ZOOM = 13;
