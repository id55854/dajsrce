"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const shipmentMethods = [
  { value: "self_dropoff", label: "Self drop-off" },
  { value: "courier_pickup", label: "Courier pickup" },
  { value: "parcel_locker", label: "Parcel locker / Paketomat" },
  { value: "ngo_pickup", label: "NGO pickup" },
  { value: "third_party_partner", label: "Third-party partner" },
] as const;

export default function NewCompanyActionPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    ngo_name: "",
    support_type: "goods",
    note: "",
    shipment_method: "courier_pickup",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/company-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to create action");
      }
      router.push(`/company/confirmations/${data.action.confirmation_slug}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create action"
      );
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        New Corporate Support Action
      </h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Create a trackable donation action and generate confirmation page.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <label className="block text-sm">
          NGO name
          <input
            required
            value={form.ngo_name}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, ngo_name: event.target.value }))
            }
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <label className="block text-sm">
          Support type
          <select
            value={form.support_type}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, support_type: event.target.value }))
            }
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="goods">Goods donation</option>
            <option value="money">Money donation</option>
            <option value="volunteering">Volunteering</option>
            <option value="mixed">Mixed support</option>
          </select>
        </label>
        <label className="block text-sm">
          Shipment method
          <select
            value={form.shipment_method}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                shipment_method: event.target.value,
              }))
            }
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
          >
            {shipmentMethods.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Thank-you note (optional)
          <textarea
            rows={4}
            value={form.note}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, note: event.target.value }))
            }
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {loading ? "Creating..." : "Create action"}
        </button>
      </form>
    </div>
  );
}
