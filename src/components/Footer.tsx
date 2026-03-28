import { Heart } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-gray-50 py-8 text-gray-500">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 text-center sm:px-6 lg:px-8">
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm sm:text-base">
          <span className="font-medium text-gray-600">DajSrce</span>
          <Heart
            className="inline h-4 w-4 fill-red-400 text-red-400"
            strokeWidth={2}
            aria-hidden
          />
          <span>Povežimo one koji daju s onima kojima treba</span>
        </p>
        <p className="text-sm">Projekt za društveno dobro</p>
      </div>
    </footer>
  );
}
