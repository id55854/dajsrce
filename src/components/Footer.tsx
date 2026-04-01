import { Heart } from "lucide-react";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-gray-50 py-8 text-gray-500 dark:bg-gray-900 dark:text-gray-500">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 text-center sm:px-6 lg:px-8">
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm sm:text-base">
          <span className="font-medium text-gray-600 dark:text-gray-300">DajSrce</span>
          <Heart
            className="inline h-4 w-4 fill-red-400 text-red-400"
            strokeWidth={2}
            aria-hidden
          />
          <span>Connecting donors with those in need</span>
        </p>
        <p className="text-sm">
          A project for the public good · {year}
        </p>
      </div>
    </footer>
  );
}
