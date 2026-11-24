import { z } from "zod";

export const swapRequestIdSchema = z.string().uuid();
export const swapStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const createSwapRequestSchema = z
  .object({ targetId: z.string().uuid().optional() })
  .strict();

export const approveSwapSchema = z
  .object({ assigneeId: z.string().uuid().optional() })
  .strict();

export const rejectSwapSchema = z.object({}).strict();

export const swapListQuerySchema = z
  .object({ status: swapStatusSchema.optional() })
  .strict();
