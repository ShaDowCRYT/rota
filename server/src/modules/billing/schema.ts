import { z } from "zod";

export const planIdSchema = z.enum(["starter", "team", "business"]);

export const quoteRequestSchema = z
  .object({
    newPlanId: planIdSchema,
    newSeats: z.number().int().positive(),
  })
  .strict();
