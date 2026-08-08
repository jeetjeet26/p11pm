import {
  ChatAccessError,
  getConversationSummariesPage,
  requireChatAuthContext,
  requireChatContext,
} from "@/lib/chat/server";
import {
  channelSlug,
  conversationPageSchema,
  createConversationSchema,
  normalizeMemberIds,
} from "@/lib/chat/validation";

function errorCode(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

function accessError(error: ChatAccessError) {
  const status = error.message.startsWith("Sign in") ? 401 : 403;
  return Response.json({ error: error.message }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = conversationPageSchema.safeParse({
      conversationId: url.searchParams.get("conversationId") ?? undefined,
      afterKindRank: url.searchParams.get("afterKindRank") ?? undefined,
      afterSortAt: url.searchParams.get("afterSortAt") ?? undefined,
      afterConversationId:
        url.searchParams.get("afterConversationId") ?? undefined,
    });
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid page cursor." },
        { status: 400 },
      );
    }
    const context = await requireChatAuthContext();
    const page = await getConversationSummariesPage({
      context,
      conversationId: parsed.data.conversationId,
      cursor:
        parsed.data.afterKindRank === undefined
          ? undefined
          : {
              kindRank: parsed.data.afterKindRank,
              sortAt: parsed.data.afterSortAt!,
              conversationId: parsed.data.afterConversationId!,
            },
    });
    return Response.json(page);
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Read workspace conversations failed:", error);
    return Response.json(
      { error: "Could not load P11 Chat conversations." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createConversationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid conversation." },
        { status: 400 },
      );
    }

    const context = await requireChatContext();
    const channelData =
      parsed.data.kind === "channel" ? parsed.data : undefined;
    const requestedMemberIds =
      parsed.data.kind === "channel"
        ? parsed.data.memberIds
        : parsed.data.profileIds;
    const memberIds = normalizeMemberIds(requestedMemberIds).filter(
      (profileId) => profileId !== context.userId,
    );
    if (!channelData && memberIds.length === 0) {
      return Response.json(
        { error: "Choose at least one other teammate." },
        { status: 400 },
      );
    }
    const slug = channelData ? channelSlug(channelData.name) : "";
    if (channelData && !slug) {
      return Response.json(
        { error: "Use at least one letter or number in the channel name." },
        { status: 400 },
      );
    }

    const { data, error } = await context.supabase.rpc(
      "create_workspace_conversation",
      {
        target_kind: parsed.data.kind,
        target_name: channelData?.name ?? null,
        target_slug: channelData ? slug : null,
        target_visibility: channelData?.visibility ?? "private",
        target_member_ids: memberIds,
      },
    );
    if (error) {
      const code = errorCode(error);
      if (code === "23505") {
        return Response.json(
          { error: "A channel with that name already exists." },
          { status: 409 },
        );
      }
      if (code === "23514") {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (code === "42501") {
        return Response.json({ error: error.message }, { status: 403 });
      }
      throw error;
    }
    const conversationId = typeof data === "string" ? data : undefined;

    if (!conversationId) {
      return Response.json(
        { error: "Could not create the conversation." },
        { status: 500 },
      );
    }

    const page = await getConversationSummariesPage({
      context,
      conversationId,
      limit: 1,
    });
    const conversation = page.conversations[0];
    if (!conversation) {
      return Response.json(
        { error: "Could not load the conversation." },
        { status: 500 },
      );
    }

    return Response.json({ conversation }, { status: 201 });
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Create workspace conversation failed:", error);
    return Response.json(
      { error: "Could not create the conversation." },
      { status: 500 },
    );
  }
}
