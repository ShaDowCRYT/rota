import { z } from "zod";

const isoDate = z
  .iso.datetime({ offset: true })
  .transform((value) => new Date(value));

export const shiftIdSchema = z.string().uuid();

export const createShiftSchema = z
  .object({
    assigneeId: z.string().uuid(),
    startsAt: isoDate,
    endsAt: isoDate,
  })
  .strict();

export const updateShiftSchema = z
  .object({
    assigneeId: z.string().uuid().optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
  })
  .strict();

export const shiftListQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    mine: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    assigneeId: z.string().uuid().optional(),
  })
  .strict();
