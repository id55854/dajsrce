"use client";

export function PrintConfirmationButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 print:hidden"
    >
      Download / Print PDF
    </button>
  );
}
