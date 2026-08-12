"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function BillingError({ reset }: { reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Unable to open billing</AlertTitle>
      <AlertDescription>
        The billing ledger could not be loaded. No changes were made.
        <Button className="mt-3" onClick={reset} size="sm" variant="outline">
          <RefreshCw /> Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
