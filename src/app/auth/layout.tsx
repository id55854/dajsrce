import type { Metadata } from "next";
import type { ReactNode } from "react";

// Sign-in, sign-up, onboarding and password screens are not content: keep
// them out of search results. Each route's own layout sets its title.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
