import type { ReactNode } from "react";
import { authPageMetadata } from "../auth-metadata";

export function generateMetadata() {
  return authPageMetadata("auth.forgot_title");
}

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
