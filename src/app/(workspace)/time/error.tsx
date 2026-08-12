"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function TimeError({ reset }: { reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Unable to open timesheets</AlertTitle>
      <AlertDescription>
        Your time data could not be loaded. No changes were made.
        <Button className="mt-3" onClick={reset} size="sm" variant="outline">
          <RefreshCw /> Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
