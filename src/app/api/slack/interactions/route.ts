import { after } from "next/server";

import { createTaskFromSlack } from "@/lib/integrations/slack-data";
import {
  callSlackApi,
  postSlackNotification,
  verifySlackHttpRequest,
} from "@/lib/integrations/slack";

export const runtime = "nodejs";

interface SlackActionPayload {
  callback_id?: string;
  channel?: { id?: string };
  message?: { text?: string; ts?: string };
  trigger_id?: string;
  type?: string;
  user?: { id?: string };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string; selected_option?: { value?: string } }>
      >;
    };
  };
}

interface ShortcutMetadata {
  channelId?: string;
  messageTs?: string;
  slackUserId?: string;
}

function inputValue(
  payload: SlackActionPayload,
  blockId: string,
  actionId: string,
): string {
  return (
    payload.view?.state?.values?.[blockId]?.[actionId]?.value?.trim() ?? ""
  );
}

async function openTaskModal(payload: SlackActionPayload): Promise<void> {
  const triggerId = payload.trigger_id;
  const slackUserId = payload.user?.id;
  if (!triggerId || !slackUserId) {
    throw new Error("Slack shortcut payload is missing a trigger or user.");
  }

  const messageText = payload.message?.text?.slice(0, 3000) ?? "";
  const metadata: ShortcutMetadata = {
    channelId: payload.channel?.id,
    messageTs: payload.message?.ts,
    slackUserId,
  };

  await callSlackApi("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "add_to_pm_task_submission",
      private_metadata: JSON.stringify(metadata),
      title: { type: "plain_text", text: "Add to P11 PM" },
      submit: { type: "plain_text", text: "Create task" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "project",
          label: { type: "plain_text", text: "Project name" },
          element: {
            type: "plain_text_input",
            action_id: "project_name",
            placeholder: { type: "plain_text", text: "Exact P11 PM project name" },
          },
        },
        {
          type: "input",
          block_id: "task",
          label: { type: "plain_text", text: "Task" },
          element: {
            type: "plain_text_input",
            action_id: "task_title",
            initial_value: messageText || "Follow up on Slack message",
          },
        },
        {
          type: "input",
          block_id: "description",
          optional: true,
          label: { type: "plain_text", text: "Notes" },
          element: {
            type: "plain_text_input",
            action_id: "task_description",
            multiline: true,
            initial_value:
              payload.channel?.id && payload.message?.ts
                ? `From Slack channel ${payload.channel.id}, message ${payload.message.ts}`
                : "Created from Slack",
          },
        },
      ],
    },
  });
}

async function createTaskFromSubmission(
  payload: SlackActionPayload,
): Promise<void> {
  const projectReference = inputValue(payload, "project", "project_name");
  const title = inputValue(payload, "task", "task_title");
  const description = inputValue(
    payload,
    "description",
    "task_description",
  );

  let metadata: ShortcutMetadata = {};
  try {
    metadata = JSON.parse(
      payload.view?.private_metadata ?? "{}",
    ) as ShortcutMetadata;
  } catch {
    // Metadata is optional; the signed interaction body is still trusted.
  }

  if (!projectReference || !title) {
    throw new Error("Project and task title are required.");
  }

  const task = await createTaskFromSlack({
    projectReference,
    title,
    description,
    slackUserId: metadata.slackUserId ?? payload.user?.id,
  });

  const notifyUser = metadata.slackUserId ?? payload.user?.id;
  if (notifyUser) {
    await postSlackNotification({
      channel: notifyUser,
      text: `Created “${title}” in *${task.project.name}*.`,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.SLACK_SIGNING_SECRET || !process.env.SLACK_BOT_TOKEN) {
    return Response.json(
      { error: "Slack interactivity is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (!verifySlackHttpRequest(request, rawBody)) {
    return Response.json({ error: "Invalid Slack signature." }, { status: 401 });
  }

  const encodedPayload = new URLSearchParams(rawBody).get("payload");
  if (!encodedPayload) {
    return Response.json({ error: "Missing interaction payload." }, { status: 400 });
  }

  let payload: SlackActionPayload;
  try {
    payload = JSON.parse(encodedPayload) as SlackActionPayload;
  } catch {
    return Response.json({ error: "Invalid interaction payload." }, { status: 400 });
  }

  if (
    payload.type === "message_action" &&
    payload.callback_id === "add_to_pm_task"
  ) {
    after(async () => {
      try {
        await openTaskModal(payload);
      } catch (error) {
        console.error("Opening Slack task modal failed", error);
      }
    });
    return new Response(null, { status: 200 });
  }

  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === "add_to_pm_task_submission"
  ) {
    after(async () => {
      try {
        await createTaskFromSubmission(payload);
      } catch (error) {
        console.error("Slack task shortcut failed", error);
        const userId = payload.user?.id;
        if (userId) {
          try {
            await postSlackNotification({
              channel: userId,
              text: `Could not create the P11 PM task: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            });
          } catch (notificationError) {
            console.error(
              "Unable to report Slack shortcut failure",
              notificationError,
            );
          }
        }
      }
    });
    return Response.json({ response_action: "clear" });
  }

  return new Response(null, { status: 200 });
}
