import type {
  InstitutionCategory,
  DonationType,
  TaxCategory,
  SubscriptionTier,
  SizeClass,
  CsrdWave,
  Framework,
} from "./types";

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

// ---------------------------------------------------------------------------
// ESG & CSR — categorical display + feature flags
// ---------------------------------------------------------------------------

// Nine Profit Tax Act categories (Art. 7.7) — cover the legal universe of
// deductible recipients; UI groups them under "Other public-benefit".
export const TAX_CATEGORIES: Record<
  TaxCategory,
  { label: string; labelHr: string }
> = {
  cultural: { label: "Cultural", labelHr: "Kulturne" },
  scientific: { label: "Scientific", labelHr: "Znanstvene" },
  educational: { label: "Educational", labelHr: "Odgojno-obrazovne" },
  health: { label: "Health", labelHr: "Zdravstvene" },
  humanitarian: { label: "Humanitarian", labelHr: "Humanitarne" },
  sports: { label: "Sports", labelHr: "Sportske" },
  religious: { label: "Religious", labelHr: "Vjerske" },
  environmental: { label: "Environmental", labelHr: "Ekološke" },
  other_public_benefit: {
    label: "Other public-benefit",
    labelHr: "Druge općekorisne",
  },
};

// Official UN Sustainable Development Goals palette (un.org/sustainabledevelopment/news/communications-material).
export const SDG_GOALS: Array<{
  id: number;
  label: string;
  labelHr: string;
  color: string;
}> = [
  { id: 1, label: "No Poverty", labelHr: "Svijet bez siromaštva", color: "#E5243B" },
  { id: 2, label: "Zero Hunger", labelHr: "Svijet bez gladi", color: "#DDA63A" },
  { id: 3, label: "Good Health and Well-being", labelHr: "Zdravlje i blagostanje", color: "#4C9F38" },
  { id: 4, label: "Quality Education", labelHr: "Kvalitetno obrazovanje", color: "#C5192D" },
  { id: 5, label: "Gender Equality", labelHr: "Rodna ravnopravnost", color: "#FF3A21" },
  { id: 6, label: "Clean Water and Sanitation", labelHr: "Čista voda i sanitarni uvjeti", color: "#26BDE2" },
  { id: 7, label: "Affordable and Clean Energy", labelHr: "Pristupačna i čista energija", color: "#FCC30B" },
  { id: 8, label: "Decent Work and Economic Growth", labelHr: "Dostojanstven rad i gospodarski rast", color: "#A21942" },
  { id: 9, label: "Industry, Innovation and Infrastructure", labelHr: "Industrija, inovacije i infrastruktura", color: "#FD6925" },
  { id: 10, label: "Reduced Inequalities", labelHr: "Smanjenje nejednakosti", color: "#DD1367" },
  { id: 11, label: "Sustainable Cities and Communities", labelHr: "Održivi gradovi i zajednice", color: "#FD9D24" },
  { id: 12, label: "Responsible Consumption and Production", labelHr: "Odgovorna potrošnja i proizvodnja", color: "#BF8B2E" },
  { id: 13, label: "Climate Action", labelHr: "Klimatske promjene", color: "#3F7E44" },
  { id: 14, label: "Life Below Water", labelHr: "Očuvanje vodenog svijeta", color: "#0A97D9" },
  { id: 15, label: "Life on Land", labelHr: "Očuvanje života na zemlji", color: "#56C02B" },
  { id: 16, label: "Peace, Justice and Strong Institutions", labelHr: "Mir, pravda i snažne institucije", color: "#00689D" },
  { id: 17, label: "Partnerships for the Goals", labelHr: "Partnerstvom do ciljeva", color: "#19486A" },
];

export const SIZE_CLASSES: Record<SizeClass, { label: string; labelHr: string; headcount: string }> = {
  micro: { label: "Micro", labelHr: "Mikro", headcount: "< 10" },
  small: { label: "Small", labelHr: "Mali", headcount: "10 – 49" },
  medium: { label: "Medium", labelHr: "Srednji", headcount: "50 – 249" },
  large: { label: "Large", labelHr: "Veliki", headcount: "≥ 250" },
};

export const FRAMEWORK_LABELS: Record<Framework, { label: string; labelHr: string }> = {
  vsme_basic: { label: "VSME Basic", labelHr: "VSME Basic" },
  vsme_comp: { label: "VSME Comprehensive", labelHr: "VSME Sveobuhvatno" },
  esrs_s1: { label: "ESRS S1 (Own workforce)", labelHr: "ESRS S1" },
  esrs_s3: { label: "ESRS S3 (Affected communities)", labelHr: "ESRS S3" },
  gri_413: { label: "GRI 413 — Local communities", labelHr: "GRI 413" },
  b4si: { label: "B4SI / Impact", labelHr: "B4SI" },
};

export const CSRD_WAVES: Record<CsrdWave, { label: string; labelHr: string }> = {
  1: {
    label: "Wave 1 — Large listed & PIEs (FY 2024)",
    labelHr: "Val 1 — Velika društva od javnog interesa (FG 2024.)",
  },
  2: {
    label: "Wave 2 — Other large undertakings (FY 2025)",
    labelHr: "Val 2 — Ostala velika društva (FG 2025.)",
  },
  3: {
    label: "Wave 3 — Listed SMEs (FY 2026)",
    labelHr: "Val 3 — Uvršteni mali i srednji (FG 2026.)",
  },
};

// Subscription tier feature flags — read by billing/gate.ts in Phase 1+.
export const SUBSCRIPTION_TIERS: Record<
  SubscriptionTier,
  {
    label: string;
    labelHr: string;
    taxReceipts: boolean;
    acknowledgements: boolean;
    exports: Array<"vsme_basic" | "vsme_comp" | "esrs_s1" | "esrs_s3" | "gri_413" | "b4si">;
    csrReport: boolean;
    publicProfile: boolean;
    teamSeats: number | "unlimited";
  }
> = {
  free: {
    label: "Free",
    labelHr: "Besplatno",
    taxReceipts: false,
    acknowledgements: true,
    exports: [],
    csrReport: false,
    publicProfile: false,
    teamSeats: 3,
  },
  sme_tax: {
    label: "SME Tax",
    labelHr: "SME — Porezne potvrde",
    taxReceipts: true,
    acknowledgements: true,
    exports: [],
    csrReport: false,
    publicProfile: false,
    teamSeats: 10,
  },
  sme_plus: {
    label: "SME Plus",
    labelHr: "SME Plus",
    taxReceipts: true,
    acknowledgements: true,
    exports: ["vsme_basic"],
    csrReport: true,
    publicProfile: true,
    teamSeats: 25,
  },
  enterprise: {
    label: "Enterprise",
    labelHr: "Enterprise",
    taxReceipts: true,
    acknowledgements: true,
    exports: ["vsme_basic", "vsme_comp", "esrs_s1", "esrs_s3", "gri_413", "b4si"],
    csrReport: true,
    publicProfile: true,
    teamSeats: "unlimited",
  },
};

export const COMPANY_ROLE_LABELS: Record<"owner" | "admin" | "finance" | "employee", { label: string; labelHr: string }> = {
  owner: { label: "Owner", labelHr: "Vlasnik" },
  admin: { label: "Admin", labelHr: "Administrator" },
  finance: { label: "Finance", labelHr: "Financije" },
  employee: { label: "Employee", labelHr: "Zaposlenik" },
};

export const SHIPMENT_METHOD_LABELS: Record<string, { label: string; labelHr: string }> = {
  self_dropoff: { label: "Self drop-off", labelHr: "Osobno dostavljanje" },
  courier_pickup: { label: "Courier pickup", labelHr: "Dolazak kurira" },
  parcel_locker: { label: "Parcel locker", labelHr: "Paketomat" },
  ngo_pickup: { label: "NGO pickup", labelHr: "Preuzimanje od NGO-a" },
  third_party_partner: { label: "Third-party partner", labelHr: "Partnerski prijevoznik" },
};
