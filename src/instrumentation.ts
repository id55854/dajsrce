import { assertProductionEnvironment } from "@/lib/env";

export function register() {
  if (process.env.VERCEL_ENV === "production") {
    assertProductionEnvironment();
  }
}
