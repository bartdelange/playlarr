import { z } from 'zod';

export const tidalConnectionStatusSchema = z.enum([
  'not_configured',
  'not_connected',
  'connected',
  'reconnect_required',
]);

export const tidalConfigurationSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  status: tidalConnectionStatusSchema,
  account: z.object({ id: z.string() }).nullable(),
});

export type TidalConfiguration = z.infer<typeof tidalConfigurationSchema>;

export const tidalConfigurationInputSchema = z.object({
  clientId: z.string().trim().min(1).max(256),
  redirectUri: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          (url.hostname === '127.0.0.1' || url.hostname === '[::1]'))
      );
    }, 'redirectUri must use HTTPS or an explicit loopback IP address'),
});

export type TidalConfigurationInput = z.infer<
  typeof tidalConfigurationInputSchema
>;
