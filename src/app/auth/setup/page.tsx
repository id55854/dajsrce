"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Heart, Loader2 } from "lucide-react";
import { normalizeRole } from "@/lib/auth/roles";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";

export default function SetupPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [institutionName, setInstitutionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setChecking(false);
      setError(
        "Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/auth/login");
        return;
      }
      const user = data.user;
      const isOAuth =
        user.app_metadata?.provider !== "email" &&
        user.app_metadata?.provider !== undefined;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, institution_id")
        .eq("id", user.id)
        .maybeSingle();

      const r = normalizeRole(profile?.role);
      const setupDone = user.user_metadata?.setup_completed === true;

      if (r === "ngo" && profile?.institution_id) {
        router.replace("/dashboard");
        return;
      }
      if (r === "ngo" && !profile?.institution_id) {
        setChecking(false);
        return;
      }
      if (r === "individual" && !isOAuth) {
        router.replace("/dashboard");
        return;
      }
      if (r === "individual" && isOAuth && setupDone) {
        router.replace("/dashboard");
        return;
      }

      setChecking(false);
    });
  }, [router]);

  async function handleSubmit() {
    if (!isSupabaseConfigured) {
      setError(
        "Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }
    if (!role) {
      setError("Please select a role.");
      return;
    }
    if (role === "ngo" && !institutionName.trim()) {
      setError("Please enter your NGO name.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ role })
        .eq("id", user.id);

      if (updateErr) throw updateErr;

      const meta: Record<string, string | boolean> = { role };
      if (role === "individual") {
        meta.setup_completed = true;
      }

      await supabase.auth.updateUser({
        data: meta,
      });

      if (role === "ngo" && institutionName.trim()) {
        const { data: inst, error: instErr } = await supabase
          .from("institutions")
          .insert({
            name: institutionName.trim(),
            category: "social_welfare",
            description: `${institutionName.trim()} — registered through DajSrce`,
            address: "To be updated",
            city: "Zagreb",
            lat: 45.8131,
            lng: 15.9775,
            served_population: "General",
          })
          .select("id")
          .single();

        if (instErr) throw instErr;
        if (!inst?.id) throw new Error("Could not create institution.");

        const { error: linkErr } = await supabase
          .from("profiles")
          .update({ institution_id: inst.id })
          .eq("id", user.id);

        if (linkErr) throw linkErr;
      }

      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-red-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/80 to-amber-50/40 px-4 py-12">
      <div className="mx-auto w-full max-w-lg space-y-8">
        <div className="rounded-2xl border border-red-100/80 bg-white/95 p-8 shadow-lg shadow-red-500/5">
          <div className="mb-6 flex items-center justify-center gap-2 text-red-500">
            <Heart className="h-8 w-8 fill-current" strokeWidth={1.5} />
            <span className="text-xl font-bold text-gray-900">DajSrce</span>
          </div>

          <h1 className="mb-2 text-center text-xl font-semibold text-gray-800">
            Welcome! Who are you?
          </h1>
          <p className="mb-6 text-center text-sm text-gray-600">
            Select your role to get started.
          </p>

          {error ? (
            <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setRole("individual");
                setError(null);
              }}
              className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all ${
                role === "individual"
                  ? "border-red-500 bg-red-50/50 shadow-md shadow-red-500/10"
                  : "border-gray-200 bg-white hover:border-red-200"
              }`}
            >
              <Heart
                className={`h-10 w-10 ${role === "individual" ? "text-red-500" : "text-gray-400"}`}
                strokeWidth={1.75}
              />
              <span className="font-semibold text-gray-900">I want to help</span>
              <span className="text-xs text-gray-500">Individual / Volunteer</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRole("ngo");
                setError(null);
              }}
              className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all ${
                role === "ngo"
                  ? "border-red-500 bg-red-50/50 shadow-md shadow-red-500/10"
                  : "border-gray-200 bg-white hover:border-red-200"
              }`}
            >
              <Building2
                className={`h-10 w-10 ${role === "ngo" ? "text-red-500" : "text-gray-400"}`}
                strokeWidth={1.75}
              />
              <span className="font-semibold text-gray-900">
                I represent an NGO
              </span>
              <span className="text-xs text-gray-500">NGO / Association</span>
            </button>
          </div>

          {role === "ngo" ? (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                NGO name
              </label>
              <input
                type="text"
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
                placeholder="e.g. Zagreb Homeless Shelter"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4"
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !role}
            className="mt-6 w-full rounded-xl bg-red-500 py-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Setting up…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
