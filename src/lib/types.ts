export type InstitutionCategory =
  | "association"
  | "homeless_shelter"
  | "soup_kitchen"
  | "children_home"
  | "caritas"
  | "disability_support"
  | "domestic_violence"
  | "elderly_care"
  | "social_welfare"
  | "student_housing"
  | "mental_health"
  | "refugee_migrant_support"
  | "medical_patient_support";

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

export type UserRole = "individual" | "ngo" | "superadmin";

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
  served_population: string | null;
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
  /** Declared value in EUR (Phase 1 tax receipts). */
  amount_eur?: number | null;
  delivered_at?: string | null;
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

export type Locale = "hr" | "en";

export type PledgeAcknowledgementKind = "manual" | "auto";

export interface PledgeAcknowledgement {
  id: string;
  pledge_id: string;
  institution_user_id: string | null;
  signed_at: string;
  kind: PledgeAcknowledgementKind;
  notes: string | null;
  delivery_photo_url: string | null;
  signature_hash: string;
  created_at: string;
}

export interface VolunteerHours {
  id: string;
  volunteer_signup_id: string;
  user_id: string;
  institution_id: string;
  hours: number;
  recorded_by: string | null;
  recorded_at: string;
}
