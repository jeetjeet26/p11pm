import { z } from "zod";

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();
const shortText = z.string().trim().min(1).max(240);
const optionalText = z.string().trim().max(20_000).nullable().optional();
const status = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/, "Use a lowercase status token.");
const currency = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase());
const money = z.number().finite().min(0).max(1_000_000_000);
const coercedMoney = z.coerce.number().finite().min(0).max(1_000_000_000);
const signedMoney = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const date = z.iso.date();
const dateTime = z.iso.datetime({ offset: true });
const localOrOffsetDateTime = z.union([
  dateTime,
  z.iso.datetime({ local: true }),
]);
const optionalEmail = z.preprocess(
  (value) => (value === "" ? null : value),
  z.email().max(320).nullable().optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? null : value),
  z.url().max(2_000).nullable().optional(),
);

const pagination = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  q: z.string().trim().min(1).max(160).optional(),
  id: uuid.optional(),
  status: status.optional(),
};

export const clientQuerySchema = z
  .object({
    ...pagination,
    ownerId: uuid.optional(),
    parentClientId: uuid.optional(),
  })
  .strict();

const clientFields = {
  name: z.string().trim().min(2).max(160),
  status: status.default("active"),
  parentClientId: nullableUuid,
  website: optionalUrl,
  phone: z.string().trim().max(80).nullable().optional(),
  billingEmail: optionalEmail,
  email: optionalEmail,
  industry: z.string().trim().max(160).nullable().optional(),
  notes: optionalText,
  ownerId: nullableUuid,
  defaultCurrency: currency.optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
};
export const createClientSchema = z.object(clientFields).strict();
export const updateClientSchema = z
  .object(clientFields)
  .partial()
  .extend({ id: uuid })
  .strict();

export const contactQuerySchema = z
  .object({
    ...pagination,
    clientId: uuid.optional(),
  })
  .strict();

const contactFields = {
  name: z.string().trim().min(1).max(201).optional(),
  clientId: uuid.nullable().optional(),
  role: z.string().trim().max(160).nullable().optional(),
  isPrimary: z.boolean().optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: optionalEmail,
  phone: z.string().trim().max(80).nullable().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  status: status.default("active"),
  reuseExisting: z.boolean().optional(),
};
export const createContactSchema = z
  .object(contactFields)
  .strict()
  .refine((value) => Boolean(value.name || value.firstName), {
    message: "A contact name is required.",
    path: ["name"],
  });
export const updateContactSchema = z
  .object(contactFields)
  .partial()
  .extend({ id: uuid })
  .strict();

export const clientActivityQuerySchema = z
  .object({
    ...pagination,
    clientId: uuid.optional(),
    contactId: uuid.optional(),
    projectId: uuid.optional(),
    activityType: status.optional(),
    from: dateTime.optional(),
    to: dateTime.optional(),
  })
  .strict();

const clientActivityFields = {
  clientId: uuid,
  contactId: nullableUuid,
  projectId: nullableUuid,
  activityType: status.optional(),
  type: status.optional(),
  subject: shortText,
  body: optionalText,
  occurredAt: localOrOffsetDateTime.optional(),
};
export const createClientActivitySchema = z
  .object(clientActivityFields)
  .strict()
  .refine((value) => Boolean(value.activityType || value.type), {
    message: "An activity type is required.",
    path: ["activityType"],
  });
export const updateClientActivitySchema = z
  .object(clientActivityFields)
  .partial()
  .extend({ id: uuid })
  .strict();

export const retainerQuerySchema = z
  .object({
    ...pagination,
    clientId: uuid.optional(),
  })
  .strict();

const retainerFields = {
  clientId: uuid,
  name: z.string().trim().min(2).max(160),
  status: status.default("draft"),
  billingModel: status.optional(),
  cadence: status.default("monthly"),
  startDate: date,
  endDate: date.nullable().optional(),
  allowanceMinutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
  allowanceHours: z.coerce.number().min(0).max(166_666).optional(),
  fixedFee: money.nullable().optional(),
  value: coercedMoney.nullable().optional(),
  allowanceType: z
    .enum(["fixed_value", "fixed_hours", "unlimited_hours", "deliverables"])
    .default("fixed_value"),
  allowanceValue: coercedMoney.nullable().optional(),
  rolloverPolicy: z
    .enum(["none", "next_period", "contract"])
    .default("none"),
  overagePolicy: z
    .enum(["do_not_bill", "bill", "unlimited", "manual_review"])
    .default("do_not_bill"),
  overageRate: money.nullable().optional(),
  hourlyRate: coercedMoney.nullable().optional(),
  autoRenew: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .default(false),
  renewalDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  invoiceTiming: z
    .enum(["period_start", "period_end", "manual"])
    .default("period_start"),
  currency: currency.default("USD"),
};
export const createRetainerSchema = z
  .object(retainerFields)
  .strict()
  .refine(
    (value) =>
      value.allowanceType !== "fixed_hours" ||
      value.allowanceMinutes !== undefined ||
      value.allowanceHours !== undefined,
    { message: "A retainer allowance is required.", path: ["allowanceHours"] },
  )
  .refine(
    (value) => !value.endDate || value.endDate >= value.startDate,
    { message: "End date must be on or after start date.", path: ["endDate"] },
  );
export const updateRetainerSchema = z
  .object(retainerFields)
  .partial()
  .extend({ id: uuid })
  .strict()
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.endDate >= value.startDate,
    { message: "End date must be on or after start date.", path: ["endDate"] },
  );

export const timeEntryQuerySchema = z
  .object({
    ...pagination,
    clientId: uuid.optional(),
    projectId: uuid.optional(),
    profileId: uuid.optional(),
    retainerId: uuid.optional(),
    status: z.enum(["draft", "submitted", "approved", "rejected", "invoiced"]).optional(),
    billable: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .strict();

const timeEntryFields = {
  profileId: uuid.optional(),
  clientId: uuid.nullable().optional(),
  projectId: uuid,
  todoId: nullableUuid,
  retainerId: nullableUuid,
  retainerPeriodId: nullableUuid,
  entryDate: date,
  durationMinutes: z.number().int().min(1).max(1_440),
  description: z.string().trim().min(1).max(1_000),
  billable: z.boolean().default(true),
  status: status.default("draft"),
  billRate: money.nullable().optional(),
  costRate: money.nullable().optional(),
  currency: currency.default("USD"),
  invoiceLineItemId: nullableUuid,
};
export const createTimeEntrySchema = z.object(timeEntryFields).strict();
export const updateTimeEntrySchema = z
  .object(timeEntryFields)
  .partial()
  .extend({ id: uuid })
  .strict();

export const bulkTimeEntryStatusSchema = z
  .object({
    ids: z.array(uuid).min(1).max(500),
    status: z.enum(["approved", "rejected"]),
    rejectionReason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .refine((value) => new Set(value.ids).size === value.ids.length, {
    message: "Time entry IDs must be unique.",
    path: ["ids"],
  })
  .refine(
    (value) => value.status !== "rejected" || Boolean(value.rejectionReason),
    {
      message: "A rejection reason is required.",
      path: ["rejectionReason"],
    },
  );

export const invoiceQuerySchema = z
  .object({
    ...pagination,
    clientId: uuid.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .strict();

const invoiceFields = {
  clientId: uuid,
  invoiceNumber: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(1).max(240),
  attentionTo: z.string().trim().max(240).nullable().optional(),
  billingAddress: z
    .object({
      line1: z.string().trim().max(240).optional(),
      line2: z.string().trim().max(240).optional(),
      city: z.string().trim().max(120).optional(),
      region: z.string().trim().max(120).optional(),
      postalCode: z.string().trim().max(40).optional(),
      country: z.string().trim().max(120).optional(),
    })
    .strict()
    .optional(),
  status: status.default("draft"),
  issueDate: date,
  dueDate: date,
  servicePeriodStart: date.nullable().optional(),
  servicePeriodEnd: date.nullable().optional(),
  currency: currency.default("USD"),
  subtotal: money.default(0),
  taxTotal: money.default(0),
  total: money.default(0),
  amountPaid: money.optional(),
  balanceDue: money.optional(),
  notes: optionalText,
  paymentInstructions: optionalText,
  paymentTerms: optionalText,
  projectId: nullableUuid,
  lineItems: z
    .array(
      z
        .object({
          projectId: nullableUuid,
          retainerId: nullableUuid,
          retainerPeriodId: nullableUuid,
          itemType: z
            .enum(["service", "material", "fee", "deposit", "credit"])
            .default("service"),
          description: z.string().trim().min(1).max(500),
          details: optionalText,
          servicePeriodStart: date.nullable().optional(),
          servicePeriodEnd: date.nullable().optional(),
          quantity: z.number().finite().positive().max(1_000_000),
          unitPrice: money,
          lineTotal: signedMoney.optional(),
        })
        .strict(),
    )
    .min(1)
    .max(500)
    .optional(),
};
export const createInvoiceSchema = z
  .object(invoiceFields)
  .strict()
  .refine((value) => value.dueDate >= value.issueDate, {
    message: "Due date must be on or after issue date.",
    path: ["dueDate"],
  })
  .refine(
    (value) =>
      !value.servicePeriodStart ||
      !value.servicePeriodEnd ||
      value.servicePeriodEnd >= value.servicePeriodStart,
    {
      message: "Service period end must be on or after its start.",
      path: ["servicePeriodEnd"],
    },
  )
  .refine(
    (value) =>
      (value.lineItems?.every(
        (line) =>
          !line.servicePeriodStart ||
          !line.servicePeriodEnd ||
          line.servicePeriodEnd >= line.servicePeriodStart,
      ) ?? true),
    {
      message: "Every line service period must end on or after it starts.",
      path: ["lineItems"],
    },
  );

export const createTimeInvoiceSchema = z
  .object({
    clientId: uuid,
    projectId: uuid.nullable().optional(),
    invoiceNumber: z.string().trim().min(1).max(64),
    subject: z.string().trim().min(1).max(240).default("Professional services"),
    issueDate: date,
    dueDate: date,
    timeEntryIds: z.array(uuid).min(1).max(500),
    taxTotal: money.default(0),
  })
  .strict()
  .refine((value) => value.dueDate >= value.issueDate, {
    message: "Due date must be on or after issue date.",
    path: ["dueDate"],
  })
  .refine(
    (value) => new Set(value.timeEntryIds).size === value.timeEntryIds.length,
    {
      message: "Time entry IDs must be unique.",
      path: ["timeEntryIds"],
    },
  );
export const updateInvoiceSchema = z
  .object(invoiceFields)
  .partial()
  .extend({ id: uuid })
  .strict()
  .refine(
    (value) =>
      !value.issueDate || !value.dueDate || value.dueDate >= value.issueDate,
    {
      message: "Due date must be on or after issue date.",
      path: ["dueDate"],
    },
  );

export const paymentQuerySchema = z
  .object({
    ...pagination,
    clientId: uuid.optional(),
    invoiceId: uuid.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .strict();

const paymentFields = {
  clientId: uuid,
  invoiceId: uuid.optional(),
  paymentDate: date,
  amount: money.min(0.01),
  currency: currency.default("USD"),
  method: z
    .enum(["bank_transfer", "card", "check", "cash", "credit", "other"])
    .default("other"),
  reference: z.string().trim().max(200).nullable().optional(),
  notes: optionalText,
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  allocations: z
    .array(
      z
        .object({
          invoiceId: uuid,
          amount: money.min(0.01),
        })
        .strict(),
    )
    .min(1)
    .max(100)
    .optional(),
};
export const createPaymentSchema = z
  .object(paymentFields)
  .strict()
  .refine(
    (value) =>
      !value.allocations ||
      new Set(value.allocations.map((allocation) => allocation.invoiceId)).size ===
        value.allocations.length,
    {
      message: "Each invoice can only be allocated once per payment.",
      path: ["allocations"],
    },
  )
  .refine(
    (value) =>
      !value.allocations ||
      value.allocations.reduce((sum, allocation) => sum + allocation.amount, 0) <=
        value.amount,
    {
      message: "Payment allocations cannot exceed the payment amount.",
      path: ["allocations"],
    },
  )
  .refine(
    (value) =>
      !value.invoiceId ||
      !value.allocations?.length ||
      (value.allocations.length === 1 &&
        value.allocations[0]?.invoiceId === value.invoiceId),
    {
      message: "Invoice and allocation targets must agree.",
      path: ["invoiceId"],
    },
  );
export const updatePaymentSchema = z
  .object(paymentFields)
  .partial()
  .extend({ id: uuid })
  .strict();

export type ClientQuery = z.infer<typeof clientQuerySchema>;
export type ContactQuery = z.infer<typeof contactQuerySchema>;
export type ClientActivityQuery = z.infer<typeof clientActivityQuerySchema>;
export type RetainerQuery = z.infer<typeof retainerQuerySchema>;
export type TimeEntryQuery = z.infer<typeof timeEntryQuerySchema>;
export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>;
export type PaymentQuery = z.infer<typeof paymentQuerySchema>;
