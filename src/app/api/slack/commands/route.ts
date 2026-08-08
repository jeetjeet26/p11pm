import { after } from "next/server";

import {
  createTaskFromSlack,
  formatMyTasks,
  formatProjectStatus,
} from "@/lib/integrations/slack-data";
import {
  respondToSlackCommand,
  verifySlackHttpRequest,
} from "@/lib/integrations/slack";

export const runtime = "nodejs";

const USAGE =
  "Try `/pm create task Project name | Task title`, `/pm my tasks`, or `/pm project status Project name`.";

interface SlackCommand {
  command: string;
  responseUrl: string;
  text: string;
  userId: string;
}

function parseForm(rawBody: string): SlackCommand {
  const form = new URLSearchParams(rawBody);
  return {
    command: form.get("command") ?? "",
    responseUrl: form.get("response_url") ?? "",
    text: (form.get("text") ?? "").trim(),
    userId: form.get("user_id") ?? "",
  };
}

function queueResponse(
  responseUrl: string,
  operation: () => Promise<string>,
): void {
  after(async () => {
    try {
      const text = await operation();
      await respondToSlackCommand(responseUrl, {
        response_type: "ephemeral",
        text,
      });
    } catch (error) {
      console.error("Slack /pm command failed", error);
      try {
        await respondToSlackCommand(responseUrl, {
          response_type: "ephemeral",
          text: `P11 PM could not complete that request: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        });
      } catch (responseError) {
        console.error("Unable to report Slack command failure", responseError);
      }
    }
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.SLACK_SIGNING_SECRET) {
    return Response.json(
      { error: "Slack request verification is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (!verifySlackHttpRequest(request, rawBody)) {
    return Response.json({ error: "Invalid Slack signature." }, { status: 401 });
  }

  const command = parseForm(rawBody);
  if (command.command !== "/pm" || !command.responseUrl || !command.userId) {
    return Response.json({ error: "Invalid Slack command payload." }, { status: 400 });
  }

  if (/^my\s+tasks$/i.test(command.text)) {
    queueResponse(command.responseUrl, () => formatMyTasks(command.userId));
  } else {
    const projectStatus = command.text.match(/^project\s+status\s+(.+)$/i);
    const createTask = command.text.match(/^create\s+task\s+(.+?)\s*\|\s*(.+)$/i);

    if (projectStatus) {
      queueResponse(command.responseUrl, () =>
        formatProjectStatus(projectStatus[1].trim()),
      );
    } else if (createTask) {
      queueResponse(command.responseUrl, async () => {
        const task = await createTaskFromSlack({
          projectReference: createTask[1].trim(),
          title: createTask[2].trim(),
          slackUserId: command.userId,
        });
        return `Created “${createTask[2].trim()}” in *${task.project.name}*.`;
      });
    } else {
      return Response.json({
        response_type: "ephemeral",
        text: USAGE,
      });
    }
  }

  return Response.json({
    response_type: "ephemeral",
    text: "Working on it…",
  });
}
