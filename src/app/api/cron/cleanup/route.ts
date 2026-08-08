import { createAdminClient } from "@/lib/supabase/admin";
import {
  boundedBatchSize,
  isCronRequestAuthorized,
} from "@/lib/uploads/cron-auth";

export const runtime = "nodejs";

type ClaimedDeletion = {
  id: string;
  bucket_id: "project-files" | "workspace-chat-files";
  object_path: string;
  lock_token: string;
};

function dryRunSetting(url: URL) {
  const requested = url.searchParams.get("dryRun");
  if (requested === "true") return true;
  if (requested === "false") return false;
  return process.env.OPERATIONS_CLEANUP_DRY_RUN !== "false";
}

async function runCleanupWorker(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return Response.json(
      { error: "Supabase service role is not configured." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const batchSize = boundedBatchSize(
    url.searchParams.get("batchSize"),
    250,
    1_000,
  );
  const dryRun = dryRunSetting(url);
  const cleanup = await admin.rpc("run_operations_cleanup", {
    requested_batch_size: batchSize,
    dry_run: dryRun,
  });
  if (cleanup.error) {
    console.error("Operations cleanup RPC failed:", cleanup.error);
    return Response.json(
      { error: "Could not run operations cleanup." },
      { status: 500 },
    );
  }

  const deletions = {
    claimed: 0,
    completed: 0,
    retried: 0,
    deadLettered: 0,
    leaseErrors: 0,
  };
  let chatEventsDeleted = 0;
  if (!dryRun) {
    const chatEventCleanup = await admin.rpc("cleanup_workspace_chat_events", {
      requested_limit: batchSize,
    });
    if (chatEventCleanup.error) {
      console.error("Workspace chat event cleanup failed:", chatEventCleanup.error);
      return Response.json(
        { error: "Operations cleanup ran, but chat event cleanup failed." },
        { status: 500 },
      );
    }
    chatEventsDeleted =
      typeof chatEventCleanup.data === "number" ? chatEventCleanup.data : 0;

    const claim = await admin.rpc("claim_storage_deletions", {
      requested_limit: Math.min(batchSize, 100),
      lease_seconds: 120,
    });
    if (claim.error) {
      console.error("Claim storage deletions failed:", claim.error);
      return Response.json(
        { error: "Cleanup ran, but object deletion claiming failed." },
        { status: 500 },
      );
    }

    const claimed = (Array.isArray(claim.data)
      ? claim.data
      : []) as ClaimedDeletion[];
    deletions.claimed = claimed.length;
    for (const deletion of claimed) {
      const removal = await admin.storage
        .from(deletion.bucket_id)
        .remove([deletion.object_path]);
      if (!removal.error) {
        const acknowledgement = await admin.rpc("ack_storage_deletion", {
          deletion_id: deletion.id,
          deletion_lock_token: deletion.lock_token,
        });
        if (acknowledgement.error || acknowledgement.data !== true) {
          deletions.leaseErrors += 1;
        } else {
          deletions.completed += 1;
        }
        continue;
      }

      const failed = await admin.rpc("fail_storage_deletion", {
        deletion_id: deletion.id,
        deletion_lock_token: deletion.lock_token,
        failure_message: removal.error.message,
      });
      if (failed.error) {
        deletions.leaseErrors += 1;
      } else if (failed.data === "dead") {
        deletions.deadLettered += 1;
        console.error("Storage deletion dead-lettered:", {
          id: deletion.id,
          bucket: deletion.bucket_id,
        });
      } else {
        deletions.retried += 1;
      }
    }
  }

  return Response.json(
    {
      cleanup: cleanup.data,
      chatEventsDeleted,
      deletions,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  return runCleanupWorker(request);
}

export async function POST(request: Request) {
  return runCleanupWorker(request);
}
