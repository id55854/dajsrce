import type { ReactNode } from "react";
import { authPageMetadata } from "../auth-metadata";

export function generateMetadata() {
  return authPageMetadata("auth.sign_in_title");
}

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
