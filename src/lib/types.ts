export type InstitutionCategory =
  | "homeless_shelter"
  | "soup_kitchen"
  | "children_home"
  | "caritas"
  | "disability_support"
  | "domestic_violence"
  | "elderly_care"
  | "social_welfare"
  | "student_housing";

export type DonationType =
  | "clothes"
  | "food"
  | "hygiene"
  | "toys_books"
  | "school_supplies"
  | "furniture"
  | "medical_supplies"
  | "baby_items"
  | "blankets_bedding"
  | "money"
  | "time";

export type UrgencyLevel = "routine" | "needed_soon" | "urgent";

export type UserRole = "individual" | "ngo" | "company" | "superadmin";

export type ShipmentMethod =
  | "self_dropoff"
  | "courier_pickup"
  | "parcel_locker"
  | "ngo_pickup"
  | "third_party_partner";

export type ShipmentStatus =
  | "pending"
  | "label_created"
  | "dropped_off"
  | "in_transit"
  | "delivered"
  | "confirmed_by_ngo"
  | "failed"
  | "cancelled";

export interface Institution {
  id: string;
  name: string;
  category: InstitutionCategory;
  description: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  working_hours: string | null;
  drop_off_hours: string | null;
  accepts_donations: DonationType[];
  capacity: string | null;
  served_population: string;
  photo_url: string | null;
  is_verified: boolean;
  is_location_hidden: boolean;
  approximate_area: string | null;
  nearest_zet_stop: string | null;
  zet_lines: string | null;
  created_at: string;
  updated_at: string;
}

export interface Need {
  id: string;
  institution_id: string;
  institution?: Institution;
  title: string;
  description: string;
  donation_type: DonationType;
  urgency: UrgencyLevel;
  quantity_needed: number | null;
  quantity_pledged: number;
  quantity_delivered: number;
  photo_url: string | null;
  deadline: string | null;
  is_fulfilled: boolean;
  created_at: string;
}

export interface VolunteerEvent {
  id: string;
  institution_id: string;
  institution?: Institution;
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  volunteers_needed: number;
  volunteers_signed_up: number;
  requirements: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  is_past: boolean;
  created_at: string;
}

export interface Pledge {
  id: string;
  user_id: string;
  need_id: string;
  need?: Need;
  quantity: number;
  message: string | null;
  status: "pledged" | "delivered" | "confirmed" | "cancelled";
  created_at: string;
}

export interface Shipment {
  id: string;
  pledge_id: string;
  donor_profile_id: string;
  ngo_institution_id: string;
  method: ShipmentMethod;
  status: ShipmentStatus;
  carrier_name: string | null;
  tracking_number: string | null;
  dropoff_location: string | null;
  donor_note: string | null;
  expected_delivery_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  neighborhood: string | null;
  interests: DonationType[];
  institution_id: string | null;
  total_pledges: number;
  total_confirmed: number;
  total_volunteer_hours: number;
  badges: string[];
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// ESG & CSR — Company tenant domain
// ---------------------------------------------------------------------------

export type CompanyRole = "owner" | "admin" | "finance" | "employee";

export type SubscriptionTier = "free" | "sme_tax" | "sme_plus" | "enterprise";

export type SubscriptionStatus =
  | "inactive"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export type SizeClass = "micro" | "small" | "medium" | "large";

export type CsrdWave = 1 | 2 | 3;

export type TaxCategory =
  | "cultural"
  | "scientific"
  | "educational"
  | "health"
  | "humanitarian"
  | "sports"
  | "religious"
  | "environmental"
  | "other_public_benefit";

export type Framework =
  | "vsme_basic"
  | "vsme_comp"
  | "esrs_s1"
  | "esrs_s3"
  | "gri_413"
  | "b4si";

export type Locale = "hr" | "en";

export interface Company {
  id: string;
  owner_id: string;
  legal_name: string;
  display_name: string | null;
  slug: string;
  oib: string | null;
  address: string | null;
  city: string | null;
  country: string;
  logo_url: string | null;
  brand_primary_hex: string | null;
  brand_secondary_hex: string | null;
  size_class: SizeClass | null;
  csrd_wave: CsrdWave | null;
  prior_year_revenue_eur: number | null;
  default_match_ratio: number;
  verified_at: string | null;
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus | string;
  public_profile_enabled: boolean;
  tagline: string | null;
  social: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface CompanyMember {
  id: string;
  company_id: string;
  profile_id: string;
  role: CompanyRole;
  department: string | null;
  joined_at: string;
  profile?: Pick<UserProfile, "id" | "email" | "name">;
}

export interface CompanyDomain {
  id: string;
  company_id: string;
  domain: string;
  verified_at: string | null;
  dns_token: string;
  created_at: string;
}

export interface CompanyInvite {
  id: string;
  company_id: string;
  email: string;
  role: Exclude<CompanyRole, "owner">;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  invited_by: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  company_id: string;
  name: string;
  slug: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  target_amount_eur: number | null;
  sdg_tags: number[];
  theme: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Extend Pledge with optional corporate metadata. The base Pledge interface
// stays untouched for read sites that don't care about it.
export interface CompanyPledgeFields {
  company_id: string | null;
  campaign_id: string | null;
  match_of_pledge_id: string | null;
  tax_category: TaxCategory | string;
  fulfilled_at: string | null;
}

export type PledgeWithCompany = Pledge & Partial<CompanyPledgeFields>;
