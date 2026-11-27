import { z } from "zod";

import { planIdSchema } from "./schema.js";

export const idempotencyKeyHeaderSchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[\x20-\x7E]+$/, "Invalid idempotency key");

export const checkoutRequestSchema = z
  .object({
    planId: planIdSchema,
    seats: z.number().int().positive(),
  })
  .strict();

export const scheduleChangeRequestSchema = checkoutRequestSchema;
