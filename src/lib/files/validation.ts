import { z } from "zod";

import { MAX_UPLOAD_SIZE } from "@/lib/uploads/contracts";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(255);

export const folderCreateSchema = z.object({
  name,
  parentId: uuid.nullable().optional(),
  projectId: uuid.nullable().optional(),
  clientId: uuid.nullable().optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

export const fileWorkspaceUploadSchema = z.object({
  folderId: uuid,
  fileName: name,
  mimeType: z.string().trim().min(1).max(255).optional(),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_SIZE),
});

export const fileMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rename"),
    name,
  }),
  z.object({
    action: z.literal("move"),
    folderId: uuid.nullable(),
  }),
  z.object({
    action: z.literal("trash"),
  }),
  z.object({
    action: z.literal("restore"),
  }),
  z.object({
    action: z.literal("favorite"),
    favorite: z.boolean(),
  }),
]);

export const folderMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rename"),
    name,
  }),
  z.object({
    action: z.literal("move"),
    parentId: uuid.nullable(),
  }),
  z.object({
    action: z.literal("trash"),
  }),
  z.object({
    action: z.literal("restore"),
  }),
  z.object({
    action: z.literal("favorite"),
    favorite: z.boolean(),
  }),
]);

export const bulkMutationSchema = z.object({
  action: z.enum(["trash", "restore", "move"]),
  fileIds: z.array(uuid).max(100).default([]),
  folderIds: z.array(uuid).max(100).default([]),
  destinationFolderId: uuid.nullable().optional(),
});

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  parentId: uuid.nullable().optional(),
});

export const shareCreateSchema = z.object({
  profileId: uuid.optional(),
  guestEmail: z.string().trim().toLowerCase().email().optional(),
  permission: z.enum(["view", "comment", "edit"]).default("view"),
  expiresAt: z.iso.datetime().nullable().optional(),
  password: z.string().min(8).max(200).optional(),
}).refine((value) => Boolean(value.profileId) !== Boolean(value.guestEmail), {
  message: "Choose one workspace member or guest email.",
});

export const versionCreateSchema = z.object({
  reservationId: uuid,
});
