"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DM_Sans } from "next/font/google";
import { Chrome, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const dmSans = DM_Sans({ subsets: ["latin"] });

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("error") === "auth_failed") {
      setError("Sign in failed. Please try again.");
    }
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/dashboard");
    });
  }, [searchParams, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signError) {
      setError(signError.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function handleGoogle() {
    setError(null);
    setGoogleLoading(true);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    setGoogleLoading(false);
    if (oauthError) setError(oauthError.message);
  }

  return (
    <div className="rounded-2xl border border-red-100/80 bg-white/95 p-8 shadow-lg shadow-red-500/5 dark:border-gray-800 dark:bg-gray-900/95">
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-red-500">
          <Heart className="h-9 w-9 fill-current" strokeWidth={1.5} />
          <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            DajSrce
          </span>
        </div>
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
          Sign In
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        ) : null}

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
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none ring-red-500/20 transition-shadow focus:border-red-400 focus:ring-4 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none ring-red-500/20 transition-shadow focus:border-red-400 focus:ring-4 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-red-500 py-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>

      <div className="relative my-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200 dark:border-gray-700" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-wide">
          <span className="bg-white px-3 text-gray-500 dark:bg-gray-900 dark:text-gray-500">
            or
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={googleLoading}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3.5 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <Chrome className="h-5 w-5 text-red-500" strokeWidth={2} />
        {googleLoading ? "Loading…" : "Continue with Google"}
      </button>

      <p className="mt-8 text-center text-sm text-gray-600 dark:text-gray-400">
        Don&apos;t have an account?{" "}
        <Link
          href="/auth/register"
          className="font-semibold text-red-500 hover:text-red-600 hover:underline"
        >
          Sign Up
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div
      className={`${dmSans.className} min-h-screen bg-gradient-to-b from-red-50/80 to-amber-50/40 px-4 py-12 dark:from-gray-950 dark:to-gray-950`}
    >
      <div className="mx-auto w-full max-w-md space-y-8">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
