"use client";

import { useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ClientApprovalActions({
  approvalId,
  initialStatus,
}: {
  approvalId: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [working, setWorking] = useState(false);

  async function respond(nextStatus: "approved" | "changes_requested") {
    setWorking(true);
    const response = await fetch("/api/client/approvals", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId, status: nextStatus }),
    });
    if (response.ok) setStatus(nextStatus);
    setWorking(false);
  }

  if (status !== "pending") {
    return <Badge variant="secondary">{status.replaceAll("_", " ")}</Badge>;
  }
  return (
    <div className="flex items-center gap-2">
      <Button disabled={working} onClick={() => void respond("approved")} size="sm">
        {working ? <LoaderCircle className="animate-spin" /> : <Check />}
        Approve
      </Button>
      <Button
        disabled={working}
        onClick={() => void respond("changes_requested")}
        size="sm"
        variant="outline"
      >
        <X />
        Request changes
      </Button>
    </div>
  );
}
