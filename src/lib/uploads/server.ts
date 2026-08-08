import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseUrl } from "@/lib/supabase/config";
import {
  getDirectStorageEndpoint,
  TUS_CHUNK_SIZE,
  type SignedTusUpload,
  type UploadReservation,
  type UploadResource,
  type UploadSession,
  type UploadTargetKind,
} from "@/lib/uploads/contracts";

const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

type UploadRpcInput = {
  targetKind: UploadTargetKind;
  targetId: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
};

type RpcError = {
  code?: string;
  message: string;
};

export class UploadServiceError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "UploadServiceError";
  }
}

function rpcError(error: RpcError, fallback: string) {
  const denied =
    error.code === "42501" ||
    /access|required|permission|privilege/i.test(error.message);
  const invalid =
    error.code === "23514" ||
    error.code === "22023" ||
    /invalid|required|must be/i.test(error.message);
  return new UploadServiceError(
    denied || invalid ? error.message : fallback,
    denied ? 403 : invalid ? 400 : 500,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asReservation<TResource extends UploadResource = UploadResource>(
  value: unknown,
): UploadReservation<TResource> | undefined {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.targetKind !== "string" ||
    typeof row.bucketName !== "string" ||
    typeof row.objectName !== "string" ||
    typeof row.fileName !== "string" ||
    typeof row.sizeBytes !== "number" ||
    typeof row.progressBytes !== "number" ||
    typeof row.status !== "string" ||
    typeof row.expiresAt !== "string"
  ) {
    return undefined;
  }

  return value as UploadReservation<TResource>;
}

async function signReservation(
  supabase: SupabaseClient,
  reservation: UploadReservation,
): Promise<SignedTusUpload> {
  if (!supabaseUrl) {
    throw new UploadServiceError("Supabase is not configured.", 503);
  }

  const { data, error } = await supabase.storage
    .from(reservation.bucketName)
    .createSignedUploadUrl(reservation.objectName, { upsert: false });
  if (error || !data?.token) {
    throw new UploadServiceError(
      error?.message ?? "Could not authorize the storage upload.",
      500,
    );
  }

  return {
    endpoint: getDirectStorageEndpoint(supabaseUrl),
    token: data.token,
    bucketName: reservation.bucketName,
    objectName: reservation.objectName,
    chunkSize: TUS_CHUNK_SIZE,
    expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
  };
}

export async function initiateUpload(
  supabase: SupabaseClient,
  input: UploadRpcInput,
): Promise<UploadSession> {
  const { data, error } = await supabase.rpc("create_upload_reservation", {
    upload_target: input.targetKind,
    target_id: input.targetId,
    upload_file_name: input.fileName,
    upload_mime_type: input.mimeType ?? null,
    upload_size_bytes: input.sizeBytes,
  });
  if (error) {
    throw rpcError(error, "Could not create the upload reservation.");
  }

  const reservation = asReservation(data);
  if (!reservation) {
    throw new UploadServiceError(
      "The upload reservation response was invalid.",
      500,
    );
  }

  try {
    return {
      reservation,
      upload: await signReservation(supabase, reservation),
    };
  } catch (error) {
    await supabase.rpc("fail_upload_reservation", {
      reservation_id: reservation.id,
      failure_message: "signed_upload_token_failed",
    });
    throw error;
  }
}

export async function getUploadSession<TResource extends UploadResource>(
  supabase: SupabaseClient,
  reservationId: string,
  expectedTarget: UploadTargetKind,
): Promise<UploadSession<TResource> | undefined> {
  const { data, error } = await supabase.rpc("get_upload_reservation", {
    reservation_id: reservationId,
  });
  if (error) {
    throw rpcError(error, "Could not read the upload reservation.");
  }

  const reservation = asReservation<TResource>(data);
  if (!reservation || reservation.targetKind !== expectedTarget) {
    return undefined;
  }

  return {
    reservation,
    ...(reservation.status === "pending"
      ? { upload: await signReservation(supabase, reservation) }
      : {}),
  };
}

export async function reportUploadProgress<TResource extends UploadResource>(
  supabase: SupabaseClient,
  reservationId: string,
  expectedTarget: UploadTargetKind,
  bytesUploaded: number,
) {
  const { data, error } = await supabase.rpc("report_upload_progress", {
    reservation_id: reservationId,
    reported_bytes: bytesUploaded,
  });
  if (error) {
    throw rpcError(error, "Could not record upload progress.");
  }

  const reservation = asReservation<TResource>(data);
  if (!reservation || reservation.targetKind !== expectedTarget) {
    return undefined;
  }
  return reservation;
}

export async function finalizeUpload<TResource extends UploadResource>(
  supabase: SupabaseClient,
  reservationId: string,
  expectedTarget: UploadTargetKind,
) {
  const { data, error } = await supabase.rpc("finalize_upload_reservation", {
    reservation_id: reservationId,
  });
  if (error) {
    throw rpcError(error, "Could not finalize the upload.");
  }

  const reservation = asReservation<TResource>(data);
  if (!reservation || reservation.targetKind !== expectedTarget) {
    return undefined;
  }
  if (reservation.status === "failed") {
    throw new UploadServiceError(
      reservation.failureReason ?? "Upload validation failed.",
      422,
    );
  }
  if (
    reservation.status !== "finalized" ||
    !reservation.resource
  ) {
    throw new UploadServiceError(
      "The storage upload is not complete yet.",
      409,
    );
  }

  return reservation;
}
