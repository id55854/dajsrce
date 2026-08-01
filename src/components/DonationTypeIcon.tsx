import {
  Apple,
  Baby,
  Banknote,
  BedDouble,
  BookOpen,
  Clock,
  Droplets,
  Pencil,
  Shirt,
  Sofa,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type { DonationType } from "@/lib/types";

const ICONS: Record<DonationType, LucideIcon> = {
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

export function DonationTypeIcon({
  type,
  className,
}: {
  type: DonationType;
  className?: string;
}) {
  const Icon = ICONS[type];
  return <Icon className={className} aria-hidden="true" />;
}
