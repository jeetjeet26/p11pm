import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const createFromTimeSchema = z.object({
  action: z.literal("invoice_time"),
  clientId: z.string().uuid(),
  projectId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(64),
  issueDate: z.string().date(),
  dueDate: z.string().date(),
  timeEntryIds: z.array(z.string().uuid()).min(1).max(500),
  taxCents: z.number().int().nonnegative().default(0),
});

export async function GET() {
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase.rpc("get_billing_workbench", {
    through_date: new Date().toISOString().slice(0, 10),
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ readyToBill: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = createFromTimeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid billing request." },
      { status: 400 },
    );
  }
  if (parsed.data.dueDate < parsed.data.issueDate) {
    return Response.json(
      { error: "Due date must be on or after issue date." },
      { status: 400 },
    );
  }
  const auth = await managerContext();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase.rpc(
    "create_invoice_from_time_entries",
    {
      target_client_id: parsed.data.clientId,
      target_project_id: parsed.data.projectId,
      target_invoice_number: parsed.data.invoiceNumber,
      target_issue_date: parsed.data.issueDate,
      target_due_date: parsed.data.dueDate,
      target_time_entry_ids: parsed.data.timeEntryIds,
      target_tax_cents: parsed.data.taxCents,
    },
  );
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ invoice: data }, { status: 201 });
}

async function managerContext() {
  const viewer = await getViewer();
  if (!viewer) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!viewer.capabilities.commercialWrite) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Manager access required." },
        { status: 403 },
      ),
    };
  }
  const supabase = await createClient();
  if (!supabase) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  return { ok: true as const, supabase };
}
