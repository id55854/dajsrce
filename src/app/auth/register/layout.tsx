import type { ReactNode } from "react";
import { authPageMetadata } from "../auth-metadata";

export function generateMetadata() {
  return authPageMetadata("auth.sign_up_title");
}

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
