import { cookies } from "next/headers";
import Link from "next/link";
import { MessageCircleOff } from "lucide-react";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChatAccessError,
  getChatProfiles,
  getConversationSummaries,
  requireChatContext,
} from "@/lib/chat/server";
import { isDemoModeAllowed } from "@/lib/demo-mode";

export const metadata = { title: "P11 Chat" };

function ChatUnavailable({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            <MessageCircleOff className="size-5" />
          </div>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          <Button asChild className="mt-5">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const demoMode =
    isDemoModeAllowed() && cookieStore.get("p11-demo")?.value === "true";

  if (demoMode) {
    return (
      <ChatUnavailable
        description="Realtime channels and direct messages require a signed-in P11 account and are intentionally unavailable in the local demo workspace."
        title="P11 Chat needs a live account"
      />
    );
  }

  let context;
  try {
    context = await requireChatContext();
  } catch (error) {
    if (error instanceof ChatAccessError) {
      return (
        <ChatUnavailable description={error.message} title="Chat unavailable" />
      );
    }
    throw error;
  }

  const [profiles, conversations] = await Promise.all([
    getChatProfiles(context),
    getConversationSummaries(context),
  ]);

  if (!conversations.length) {
    return (
      <ChatUnavailable
        description="No public channels are available yet. Ask a P11 administrator to apply the workspace chat migration."
        title="No conversations found"
      />
    );
  }

  return (
    <>
      <ChatWorkspace
        initialData={{
          currentProfile: context.currentProfile,
          profiles,
          conversations,
        }}
      />
      {children}
    </>
  );
}
