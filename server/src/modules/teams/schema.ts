import { z } from "zod";

export const teamIdSchema = z.string().uuid();
export const userIdSchema = z.string().uuid();
export const inviteIdSchema = z.string().uuid();
export const teamNameSchema = z.string().trim().min(1).max(120);
export const inviteRoleSchema = z.enum(["manager", "staff"]);
export const emailSchema = z.string().trim().toLowerCase().email();

export const createTeamSchema = z
  .object({ name: teamNameSchema })
  .strict();

export const createInviteSchema = z
  .object({
    email: emailSchema.optional(),
    role: inviteRoleSchema,
  })
  .strict();

export const changeRoleSchema = z
  .object({ role: inviteRoleSchema })
  .strict();

export const acceptInviteSchema = z
  .object({ token: z.string().min(20).max(200) })
  .strict();
