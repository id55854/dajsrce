"use client";

import { useState } from "react";
import Link from "next/link";
import { DM_Sans } from "next/font/google";
import { Building2, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";

const dmSans = DM_Sans({ subsets: ["latin"] });

export default function RegisterPage() {
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
      setError("Odaberite ulogu.");
      return;
    }
    setError(null);
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password.length < 6) {
      setError("Lozinka mora imati najmanje 6 znakova.");
      return;
    }
    if (!role) {
      setError("Nedostaje uloga.");
      return;
    }
    if (role === "institution" && !institutionName.trim()) {
      setError("Unesite naziv ustanove.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        data: {
          name,
          role,
          ...(role === "institution"
            ? { institution_name: institutionName.trim() }
            : {}),
        },
      },
    });
    setLoading(false);

    if (signError) {
      setError(signError.message);
      return;
    }

    if (data.session) {
      window.location.href = "/dashboard";
      return;
    }

    setSuccess(
      "Račun je kreiran! Provjerite e-poštu za potvrdu pa se prijavite."
    );
  }

  return (
    <div
      className={`${dmSans.className} min-h-screen bg-gradient-to-b from-red-50/80 to-amber-50/40 px-4 py-12`}
    >
      <div className="mx-auto w-full max-w-lg space-y-8">
        <div className="rounded-2xl border border-red-100/80 bg-white/95 p-8 shadow-lg shadow-red-500/5">
          <div className="mb-6 flex items-center justify-center gap-2 text-red-500">
            <Heart className="h-8 w-8 fill-current" strokeWidth={1.5} />
            <span className="text-xl font-bold text-gray-900">DajSrce</span>
          </div>

          {step === 1 ? (
            <>
              <h1 className="mb-2 text-center text-xl font-semibold text-gray-800">
                Tko ste vi?
              </h1>
              <p className="mb-6 text-center text-sm text-gray-600">
                Odaberite ulogu za nastavak registracije.
              </p>

              {error ? (
                <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-600">
                  {error}
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => selectRole("citizen")}
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
                  <span className="font-semibold text-gray-900">
                    Želim pomoći
                  </span>
                  <span className="text-xs text-gray-500">Građanin</span>
                </button>

                <button
                  type="button"
                  onClick={() => selectRole("institution")}
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
                    Predstavljam ustanovu
                  </span>
                  <span className="text-xs text-gray-500">Ustanova</span>
                </button>
              </div>

              <button
                type="button"
                onClick={goToForm}
                className="mt-6 w-full rounded-xl bg-red-500 py-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-600"
              >
                Nastavi
              </button>
            </>
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between gap-2">
                <h1 className="text-xl font-semibold text-gray-800">
                  Registracija
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
                  Natrag
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error ? (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
                    {error}
                  </p>
                ) : null}
                {success ? (
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {success}
                  </p>
                ) : null}

                <div>
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    Ime i prezime
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    E-pošta
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    Lozinka (min. 6 znakova)
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
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4"
                  />
                </div>

                {role === "institution" ? (
                  <div>
                    <label
                      htmlFor="institution"
                      className="mb-1.5 block text-sm font-medium text-gray-700"
                    >
                      Naziv ustanove
                    </label>
                    <input
                      id="institution"
                      name="institution"
                      type="text"
                      required
                      value={institutionName}
                      onChange={(e) => setInstitutionName(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4"
                    />
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-red-500 py-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-600 disabled:opacity-60"
                >
                  {loading ? "Registracija…" : "Registriraj se"}
                </button>
              </form>
            </>
          )}

          <p className="mt-8 text-center text-sm text-gray-600">
            Već imate račun?{" "}
            <Link
              href="/auth/login"
              className="font-semibold text-red-500 hover:text-red-600 hover:underline"
            >
              Prijavite se
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
