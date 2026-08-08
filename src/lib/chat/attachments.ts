import type { WorkspaceAttachment } from "@/lib/chat/types";
import {
  completeResumableUpload,
  fetchUploadJson,
} from "@/lib/uploads/client";
import {
  MAX_UPLOAD_SIZE,
  type ResumableUploadOptions,
  type UploadResource,
  type UploadSession,
  uploadCacheKey,
} from "@/lib/uploads/contracts";

export const MAX_CHAT_ATTACHMENT_SIZE = MAX_UPLOAD_SIZE;
export const MAX_CHAT_ATTACHMENTS = 5;

export async function removePendingChatAttachments(attachmentIds: string[]) {
  await Promise.allSettled(
    attachmentIds.map((attachmentId) =>
      fetch(`/api/workspace-chat/attachments/${attachmentId}`, {
        method: "DELETE",
      }),
    ),
  );
}

export async function uploadChatAttachments(
  conversationId: string,
  files: File[],
  options?: ResumableUploadOptions,
) {
  const uploaded: WorkspaceAttachment[] = [];
  try {
    for (const file of files) {
      type ChatUpload = WorkspaceAttachment & UploadResource;
      const statusUrl = (reservationId: string) =>
        `/api/workspace-chat/attachments/uploads/${reservationId}`;
      const attachment = await completeResumableUpload<ChatUpload>({
        cacheTarget: uploadCacheKey(`chat:${conversationId}`, file),
        file,
        statusUrl,
        options,
        initiate: () =>
          fetchUploadJson<UploadSession<ChatUpload>>(
            "/api/workspace-chat/attachments",
            {
              method: "POST",
              body: JSON.stringify({
                conversationId,
                fileName: file.name,
                mimeType: file.type || undefined,
                sizeBytes: file.size,
              }),
            },
          ),
        finalize: (reservationId) =>
          fetchUploadJson<UploadSession<ChatUpload>>(
            "/api/workspace-chat/attachments",
            {
              method: "PUT",
              body: JSON.stringify({ reservationId }),
            },
          ),
      });
      uploaded.push(attachment);
    }
    return uploaded;
  } catch (error) {
    await removePendingChatAttachments(
      uploaded.map((attachment) => attachment.id),
    );
    throw error;
  }
}
