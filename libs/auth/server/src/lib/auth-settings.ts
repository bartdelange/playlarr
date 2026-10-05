import { z } from 'zod';

export const authSettingsSchema = z
  .object({
    enabled: z.boolean(),
    username: z.string(),
    passwordHash: z.string(),
    sessionLifetimeSeconds: z.number().int().positive(),
  })
  .refine(
    ({ enabled, username, passwordHash }) =>
      !enabled || Boolean(username && passwordHash),
    {
      message: 'Enabled authentication requires a username and password hash',
    },
  );

export type AuthSettings = z.infer<typeof authSettingsSchema>;
