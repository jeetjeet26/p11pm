import {
  ChatAccessError,
  requireWorkspaceAdminContext,
} from "@/lib/chat/server";
import { updateWorkspaceProfileSchema } from "@/lib/chat/validation";

function errorCode(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  try {
    const parsed = updateWorkspaceProfileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid profile state." },
        { status: 400 },
      );
    }
    const { profileId } = await params;
    const context = await requireWorkspaceAdminContext();
    const { error } = await context.supabase.rpc(
      "update_workspace_profile_admin_v2",
      {
        target_profile_id: profileId,
        target_role: parsed.data.role,
        target_status: parsed.data.status,
        target_chat_enabled: parsed.data.chatEnabled,
        target_permissions: {
          "commercial.read":
            parsed.data.permissions?.commercialRead ?? false,
          "commercial.write":
            parsed.data.permissions?.commercialWrite ?? false,
          "time.approve": parsed.data.permissions?.timeApprove ?? false,
          "pipeline.write":
            parsed.data.permissions?.pipelineWrite ?? false,
          "support.read": parsed.data.permissions?.supportRead ?? false,
          "support.write": parsed.data.permissions?.supportWrite ?? false,
        },
      },
    );
    if (error) {
      const code = errorCode(error);
      if (code === "42501") {
        return Response.json({ error: error.message }, { status: 403 });
      }
      if (code === "23514" || code === "P0002") {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      const status = error.message.startsWith("Sign in") ? 401 : 403;
      return Response.json({ error: error.message }, { status });
    }
    console.error("Update workspace profile failed:", error);
    return Response.json(
      { error: "Could not update the workspace profile." },
      { status: 500 },
    );
  }
}
