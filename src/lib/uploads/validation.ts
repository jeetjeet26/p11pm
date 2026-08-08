import { z } from "zod";

import { MAX_UPLOAD_SIZE } from "@/lib/uploads/contracts";

const uuidSchema = z.string().uuid();
const fileNameSchema = z
  .string()
  .trim()
  .min(1, "Choose a file.")
  .max(255, "File names must be 255 characters or fewer.");
const mimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(255, "The file type is invalid.")
  .optional();
const sizeBytesSchema = z
  .number()
  .int()
  .positive("The file is empty.")
  .max(MAX_UPLOAD_SIZE, "Files must be 25 MB or smaller.");

export const projectUploadInitiationSchema = z.object({
  projectId: uuidSchema,
  fileName: fileNameSchema,
  mimeType: mimeTypeSchema,
  sizeBytes: sizeBytesSchema,
});

export const chatUploadInitiationSchema = z.object({
  conversationId: uuidSchema,
  fileName: fileNameSchema,
  mimeType: mimeTypeSchema,
  sizeBytes: sizeBytesSchema,
});

export const uploadFinalizationSchema = z.object({
  reservationId: uuidSchema,
});

export const uploadProgressSchema = z.object({
  bytesUploaded: z.number().int().nonnegative(),
});
