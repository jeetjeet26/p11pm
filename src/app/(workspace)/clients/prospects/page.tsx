import { ProspectPipeline } from "@/components/pipeline/prospect-pipeline";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Prospects" };

export default async function ProspectsPage() {
  const viewer = await getViewer();
  const supabase = await createClient();
  if (!viewer || !supabase) {
    return (
      <ProspectPipeline canManage={false} clients={[]} prospects={[]} />
    );
  }
  const [prospectResult, clientResult] = await Promise.all([
    supabase
      .from("prospects")
      .select(
        "id,client_id,title,stage,probability,value_cents,weighted_value_cents,currency,next_action,next_action_at,client:clients(name),owner:profiles(full_name)",
      )
      .eq("organization_id", viewer.organization.id)
      .order("value_cents", { ascending: false })
      .limit(250),
    supabase
      .from("clients")
      .select("id,name")
      .eq("organization_id", viewer.organization.id)
      .in("status", ["active", "prospect"])
      .order("name")
      .limit(1_000),
  ]);
  const prospects = (prospectResult.data ?? []).map((row) => {
    const client = Array.isArray(row.client) ? row.client[0] : row.client;
    const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: client?.name ?? "Client",
      title: row.title,
      stage: row.stage as "lead" | "qualified" | "quote" | "won" | "lost",
      probability: row.probability,
      valueCents: Number(row.value_cents),
      weightedValueCents: Number(row.weighted_value_cents),
      currency: row.currency,
      nextAction: row.next_action,
      nextActionAt: row.next_action_at,
      ownerName: owner?.full_name ?? null,
    };
  });
  return (
    <ProspectPipeline
      canManage={viewer.capabilities.pipelineWrite}
      clients={clientResult.data ?? []}
      prospects={prospects}
    />
  );
}
