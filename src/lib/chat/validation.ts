import { z } from "zod";

const uuidSchema = z.string().uuid();

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a channel name.")
  .max(80, "Channel names must be 80 characters or fewer.");

export const createConversationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("channel"),
    name: channelNameSchema,
    visibility: z.enum(["public", "private"]).default("public"),
    memberIds: z.array(uuidSchema).max(49).default([]),
  }),
  z.object({
    kind: z.literal("dm"),
    profileIds: z
      .array(uuidSchema)
      .min(1, "Choose at least one teammate.")
      .max(49, "Group direct messages can contain at most 50 people."),
  }),
]);

export const updateChannelMembersSchema = z.object({
  memberIds: z.array(uuidSchema).max(50),
});

export const updateWorkspaceProfileSchema = z.object({
  role: z.enum(["admin", "manager", "member", "viewer"]),
  status: z.enum(["active", "suspended", "deactivated"]),
  chatEnabled: z.boolean(),
});

export const createMessageSchema = z
  .object({
    conversationId: uuidSchema,
    body: z
      .string()
      .trim()
      .max(4000, "Messages must be 4,000 characters or fewer."),
    clientNonce: uuidSchema,
    parentMessageId: uuidSchema.optional(),
    attachmentIds: z.array(uuidSchema).max(5).default([]),
  })
  .refine(
    ({ body, attachmentIds }) => Boolean(body) || attachmentIds.length > 0,
    "Enter a message or attach a file.",
  );

export const uploadAttachmentSchema = z.object({
  conversationId: uuidSchema,
});

export const messagePageSchema = z
  .object({
    conversationId: uuidSchema,
    threadId: uuidSchema.optional(),
    beforeCreatedAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid message cursor.")
      .optional(),
    beforeMessageId: uuidSchema.optional(),
    afterCreatedAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid message cursor.")
      .optional(),
    afterMessageId: uuidSchema.optional(),
  })
  .refine(
    ({ beforeCreatedAt, beforeMessageId }) =>
      Boolean(beforeCreatedAt) === Boolean(beforeMessageId),
    "Both cursor values are required.",
  )
  .refine(
    ({ afterCreatedAt, afterMessageId }) =>
      Boolean(afterCreatedAt) === Boolean(afterMessageId),
    "Both forward cursor values are required.",
  )
  .refine(
    ({ beforeCreatedAt, afterCreatedAt }) =>
      !(beforeCreatedAt && afterCreatedAt),
    "Choose one message cursor direction.",
  );

export const conversationPageSchema = z
  .object({
    conversationId: uuidSchema.optional(),
    afterKindRank: z.coerce.number().int().min(0).max(1).optional(),
    afterSortAt: z
      .string()
      .refine(
        (value) => !Number.isNaN(Date.parse(value)),
        "Invalid conversation cursor.",
      )
      .optional(),
    afterConversationId: uuidSchema.optional(),
  })
  .refine(
    ({ afterKindRank, afterSortAt, afterConversationId }) => {
      const values = [afterKindRank, afterSortAt, afterConversationId];
      return values.every((value) => value === undefined) ||
        values.every((value) => value !== undefined);
    },
    "Every conversation cursor value is required.",
  )
  .refine(
    ({ conversationId, afterKindRank }) =>
      !(conversationId && afterKindRank !== undefined),
    "A direct conversation lookup cannot be paginated.",
  );

export const chatBootstrapSchema = z.object({
  conversationId: uuidSchema.optional(),
});

export const chatSyncPageSchema = z.object({
  cursor: z
    .string()
    .regex(/^\d+$/, "Invalid chat sync cursor.")
    .default("0"),
});

export const markReadSchema = z.object({
  conversationId: uuidSchema,
});

export const markThreadReadSchema = z.object({
  rootMessageId: uuidSchema,
});

export function channelSlug(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function canonicalDmPair(firstProfileId: string, secondProfileId: string) {
  return [firstProfileId, secondProfileId].sort() as [string, string];
}

export function normalizeMemberIds(
  memberIds: string[],
  currentProfileId?: string,
) {
  return [
    ...new Set(
      [...memberIds, ...(currentProfileId ? [currentProfileId] : [])].filter(
        Boolean,
      ),
    ),
  ].sort();
}

export function canonicalGroupDmName(
  currentProfileId: string,
  memberIds: string[],
  profileNames: Record<string, string>,
) {
  return normalizeMemberIds(memberIds)
    .filter((profileId) => profileId !== currentProfileId)
    .map((profileId) => profileNames[profileId] || "P11 teammate")
    .sort((first, second) => first.localeCompare(second))
    .join(", ");
}

export function canShowWorkspaceAdmin(
  role: string | undefined,
  status: string | undefined,
) {
  return role === "admin" && status === "active";
}
