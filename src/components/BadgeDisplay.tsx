import type { UserProfile } from "@/lib/types";
import {
  Award,
  HandHeart,
  Heart,
  Medal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

const BADGE_MAP: Record<
  string,
  { label: string; Icon: LucideIcon; bg: string; iconClass: string }
> = {
  first_pledge: {
    label: "Prvo obećanje",
    Icon: Heart,
    bg: "bg-rose-100",
    iconClass: "text-rose-600",
  },
  five_pledges: {
    label: "5 obećanja",
    Icon: Medal,
    bg: "bg-amber-100",
    iconClass: "text-amber-700",
  },
  first_volunteer: {
    label: "Prvi volontiranje",
    Icon: HandHeart,
    bg: "bg-sky-100",
    iconClass: "text-sky-600",
  },
  helper: {
    label: "Pomagač",
    Icon: Award,
    bg: "bg-violet-100",
    iconClass: "text-violet-600",
  },
};

type BadgeDisplayProps = {
  badges: UserProfile["badges"];
};

export function BadgeDisplay({ badges }: BadgeDisplayProps) {
  const known = badges.filter((id) => BADGE_MAP[id]);

  if (!known.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-10 text-center">
        <Sparkles className="h-8 w-8 text-red-400" strokeWidth={1.5} />
        <p className="max-w-sm text-sm font-medium text-gray-600">
          Počni pomagati da zaradiš značke!
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {known.map((id) => {
        const cfg = BADGE_MAP[id]!;
        const { Icon, label, bg, iconClass } = cfg;
        return (
          <li key={id} className="flex flex-col items-center gap-2 text-center">
            <span
              className={`flex h-16 w-16 items-center justify-center rounded-full ${bg} shadow-sm`}
            >
              <Icon className={`h-8 w-8 ${iconClass}`} strokeWidth={2} />
            </span>
            <span className="text-xs font-medium text-gray-700">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}
