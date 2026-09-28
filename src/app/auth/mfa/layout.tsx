import type { ReactNode } from "react";
import { authPageMetadata } from "../auth-metadata";

export function generateMetadata() {
  return authPageMetadata("mfa.challenge_page_title");
}

export default function MfaLayout({ children }: { children: ReactNode }) {
  return children;
}
