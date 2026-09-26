import type { ReactNode } from "react";
import { authPageMetadata } from "../auth-metadata";

export function generateMetadata() {
  return authPageMetadata("auth.reset_title");
}

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
