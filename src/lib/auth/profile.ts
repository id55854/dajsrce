import type { AppRole } from "@/lib/auth/roles";

export type AuthProfile = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  institution_id: string | null;
};
