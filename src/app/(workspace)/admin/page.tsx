import { redirect } from "next/navigation";

import { WorkspaceAdmin } from "@/components/admin/workspace-admin";
import {
  ChatAccessError,
  getWorkspaceAdminChannels,
  getWorkspaceAdminProfiles,
  requireWorkspaceAdminContext,
} from "@/lib/chat/server";

export const metadata = { title: "Workspace administration" };

async function loadAdminData() {
  try {
    const context = await requireWorkspaceAdminContext();
    const [profiles, channels] = await Promise.all([
      getWorkspaceAdminProfiles(context),
      getWorkspaceAdminChannels(context),
    ]);
    return { profiles, channels };
  } catch (error) {
    if (error instanceof ChatAccessError) redirect("/dashboard");
    throw error;
  }
}

export default async function AdminPage() {
  const { profiles, channels } = await loadAdminData();
  return (
    <WorkspaceAdmin initialChannels={channels} initialProfiles={profiles} />
  );
}
