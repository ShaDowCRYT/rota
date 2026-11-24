import { z } from "zod";

export const activityQuerySchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
