import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email").max(254),
  password: z.string().min(10, "Invalid password").max(128),
});

export type Credentials = z.infer<typeof credentialsSchema>;
