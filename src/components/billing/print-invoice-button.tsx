"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PrintInvoiceButton() {
  return (
    <Button onClick={() => window.print()} type="button" variant="outline">
      <Printer />
      Print or save PDF
    </Button>
  );
}
