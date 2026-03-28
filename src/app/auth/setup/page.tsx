"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Heart, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";

export default function SetupPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [institutionName, setInstitutionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/auth/login");
        return;
      }
      supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle()
        .then(({ data: profile }) => {
          if (profile && profile.role) {
            router.replace("/dashboard");
          } else {
            setChecking(false);
          }
        });
    });
  }, [router]);

  async function handleSubmit() {
    if (!role) {
      setError("Please select a role.");
      return;
    }
    if (role === "institution" && !institutionName.trim()) {
      setError("Please enter your institution name.");
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

      await supabase.auth.updateUser({
        data: { role },
      });

      if (role === "institution" && institutionName.trim()) {
        const { data: inst } = await supabase
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

        if (inst) {
          await supabase
            .from("profiles")
            .update({ institution_id: inst.id })
            .eq("id", user.id);
        }
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
                setRole("citizen");
                setError(null);
              }}
              className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all ${
                role === "citizen"
                  ? "border-red-500 bg-red-50/50 shadow-md shadow-red-500/10"
                  : "border-gray-200 bg-white hover:border-red-200"
              }`}
            >
              <Heart
                className={`h-10 w-10 ${role === "citizen" ? "text-red-500" : "text-gray-400"}`}
                strokeWidth={1.75}
              />
              <span className="font-semibold text-gray-900">I want to help</span>
              <span className="text-xs text-gray-500">Citizen / Volunteer</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRole("institution");
                setError(null);
              }}
              className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all ${
                role === "institution"
                  ? "border-red-500 bg-red-50/50 shadow-md shadow-red-500/10"
                  : "border-gray-200 bg-white hover:border-red-200"
              }`}
            >
              <Building2
                className={`h-10 w-10 ${role === "institution" ? "text-red-500" : "text-gray-400"}`}
                strokeWidth={1.75}
              />
              <span className="font-semibold text-gray-900">
                I represent an institution
              </span>
              <span className="text-xs text-gray-500">Institution / Shelter</span>
            </button>
          </div>

          {role === "institution" ? (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Institution name
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
