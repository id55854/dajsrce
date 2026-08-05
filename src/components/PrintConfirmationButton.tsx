"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintConfirmationButton() {
  return (
    <Button
      variant="secondary"
      onClick={() => window.print()}
      icon={<Printer className="h-4 w-4" aria-hidden="true" />}
      className="print:hidden"
    >
      Download / Print PDF
    </Button>
  );
}
