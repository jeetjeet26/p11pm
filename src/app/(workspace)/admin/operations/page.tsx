import { redirect } from "next/navigation";

import { OperationsAdmin } from "@/components/admin/operations-admin";
import { OperatorConsole } from "@/components/admin/operator-console";
import { InviteAdmin } from "@/components/admin/invite-admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Access & integrations" };

export default async function OperationsAdminPage() {
  const client = await createClient();
  if (!client) redirect("/dashboard");
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "manager"].includes(String(profile.role))) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-6">
      <OperatorConsole />
      <OperationsAdmin viewerRole={String(profile.role) as "admin" | "manager"} />
      <InviteAdmin />
    </div>
  );
}
