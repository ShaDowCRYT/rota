import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email").max(254),
  password: z.string().min(10, "Invalid password").max(128),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});

export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Invalid email").max(254),
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    newPassword: z.string().min(10, "Invalid password").max(128),
  })
  .strict();
