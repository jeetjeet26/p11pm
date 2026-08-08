import {
  ChatAccessError,
  getWorkspaceAdminChannels,
  getWorkspaceAdminProfiles,
  requireWorkspaceAdminContext,
} from "@/lib/chat/server";

export async function GET() {
  try {
    const context = await requireWorkspaceAdminContext();
    const [profiles, channels] = await Promise.all([
      getWorkspaceAdminProfiles(context),
      getWorkspaceAdminChannels(context),
    ]);
    return Response.json({ profiles, channels });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      const status = error.message.startsWith("Sign in") ? 401 : 403;
      return Response.json({ error: error.message }, { status });
    }
    console.error("Read workspace administration data failed:", error);
    return Response.json(
      { error: "Could not load workspace administration." },
      { status: 500 },
    );
  }
}
