"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/client";

/**
 * Sign out, placed at the bottom of the profile page itself now that the
 * navbar's profile icon links straight there instead of opening a dropdown.
 * The navbar's own session state updates on its own — it listens for
 * `onAuthStateChange` — so this only needs to end the session and leave.
 */
export function SignOutButton() {
  const t = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    if (isSupabaseConfigured) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Button
      variant="secondary"
      onClick={handleSignOut}
      loading={loading}
      icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
    >
      {t("nav.sign_out")}
    </Button>
  );
}
