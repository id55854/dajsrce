"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DM_Sans } from "next/font/google";
import { Building2, BriefcaseBusiness, Heart } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";

const dmSans = DM_Sans({ subsets: ["latin"] });

function RegisterForm() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<UserRole | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function selectRole(r: UserRole) {
    setRole(r);
    setError(null);
  }

  function goToForm() {
    if (!role) {
      setError("Please select a role.");
      return;
    }
    setError(null);
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isSupabaseConfigured) {
      setError(
        "Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!role) {
      setError("Role is missing.");
      return;
    }
    if ((role === "ngo" || role === "company") && !institutionName.trim()) {
      setError(role === "company" ? "Enter company name." : "Enter NGO name.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    let data: Awaited<ReturnType<typeof supabase.auth.signUp>>["data"] | null =
      null;
    let signError: Error | null = null;
    try {
      const response = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(searchParams.get("next") || "/dashboard")}`,
          data: {
            name,
            role,
            ...(role === "ngo" || role === "company"
              ? { institution_name: institutionName.trim() }
              : {}),
          },
        },
      });
      data = response.data;
      signError = response.error;
    } catch {
      signError = new Error(
        "Unable to reach authentication service. Check Supabase URL/keys and network."
      );
    }
    setLoading(false);

    if (signError || !data) {
      setError(signError?.message ?? "Sign up failed. Please try again.");
      return;
    }

    if (data.session) {
      const fallback = role === "company" ? "/dashboard/company/new" : "/dashboard";
      window.location.href = searchParams.get("next") || fallback;
      return;
    }

    setSuccess(
      "Account created! Check your email for confirmation."
    );
  }

  return (
    <div
      className={`${dmSans.className} min-h-screen bg-gradient-to-b from-red-50/80 to-amber-50/40 px-4 py-12 dark:from-gray-950 dark:to-gray-950`}
    >
      <div className="mx-auto w-full max-w-lg space-y-8">
        <div className="rounded-2xl border border-red-100/80 bg-white/95 p-8 shadow-lg shadow-red-500/5 dark:border-gray-800 dark:bg-gray-900/95">
          <div className="mb-6 flex items-center justify-center gap-2 text-red-500">
            <Heart className="h-8 w-8 fill-current" strokeWidth={1.5} />
            <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
              DajSrce
            </span>
          </div>

          {step === 1 ? (
            <>
              <h1 className="mb-2 text-center text-xl font-semibold text-gray-800 dark:text-gray-200">
                Who are you?
              </h1>
              <p className="mb-6 text-center text-sm text-gray-600 dark:text-gray-400">
                Select your role to continue.
              </p>

              {error ? (
                <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                  {error}
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => selectRole("individual")}
                  className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all ${
                    role === "individual"
                      ? "border-red-500 bg-red-50/50 shadow-md shadow-red-500/10 dark:bg-red-950/30"
                      : "border-gray-200 bg-white hover:border-red-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-red-800"
                  }`}
                >
                  <Heart
                    className={`h-10 w-10 ${role === "individual" ? "text-red-500" : "text-gray-400"}`}
                    strokeWidth={1.75}
                  />
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    I want to help
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Individual
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => selectRole("ngo")}
                  className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all ${
                    role === "ngo"
                      ? "border-red-500 bg-red-50/50 shadow-md shadow-red-500/10 dark:bg-red-950/30"
                      : "border-gray-200 bg-white hover:border-red-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-red-800"
                  }`}
                >
                  <Building2
                    className={`h-10 w-10 ${role === "ngo" ? "text-red-500" : "text-gray-400"}`}
                    strokeWidth={1.75}
                  />
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    I represent an NGO
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    NGO / Association
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => selectRole("company")}
                  className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all sm:col-span-2 ${
                    role === "company"
                      ? "border-red-500 bg-red-50/50 shadow-md shadow-red-500/10 dark:bg-red-950/30"
                      : "border-gray-200 bg-white hover:border-red-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-red-800"
                  }`}
                >
                  <BriefcaseBusiness
                    className={`h-10 w-10 ${role === "company" ? "text-red-500" : "text-gray-400"}`}
                    strokeWidth={1.75}
                  />
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    I represent a company
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Company / CSR
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={goToForm}
                className="mt-6 w-full rounded-xl bg-red-500 py-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-600"
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between gap-2">
                <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
                  Registration
                </h1>
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setError(null);
                    setSuccess(null);
                  }}
                  className="text-sm font-medium text-red-500 hover:underline"
                >
                  Back
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error ? (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                    {error}
                  </p>
                ) : null}
                {success ? (
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                    {success}
                  </p>
                ) : null}

                <div>
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Full name
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Password (min. 6 characters)
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                {role === "ngo" || role === "company" ? (
                  <div>
                    <label
                      htmlFor="institution"
                      className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                      {role === "company" ? "Company name" : "NGO name"}
                    </label>
                    <input
                      id="institution"
                      name="institution"
                      type="text"
                      required
                      value={institutionName}
                      onChange={(e) => setInstitutionName(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-red-500 py-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-600 disabled:opacity-60"
                >
                  {loading ? "Registering…" : "Sign Up"}
                </button>
              </form>
            </>
          )}

          <p className="mt-8 text-center text-sm text-gray-600 dark:text-gray-400">
            Already have an account?{" "}
            <Link
              href={`/auth/login${searchParams.get("next") ? `?next=${encodeURIComponent(searchParams.get("next") as string)}` : ""}`}
              className="font-semibold text-red-500 hover:text-red-600 hover:underline"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
