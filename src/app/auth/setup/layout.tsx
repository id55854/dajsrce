import type { ReactNode } from "react";
import { authPageMetadata } from "../auth-metadata";

export function generateMetadata() {
  return authPageMetadata("auth.setup_page_title");
}

export default function SetupLayout({ children }: { children: ReactNode }) {
  return children;
}
