import { z } from 'zod';

export const commandStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
]);

export type CommandStatus = z.infer<typeof commandStatusSchema>;

export const commandAssociationSchema = z.object({
  scope: z.string().min(1),
  entityId: z.string().min(1),
});

export type CommandAssociation = z.infer<typeof commandAssociationSchema>;

export const commandStateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: commandStatusSchema,
  current: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  currentItem: z.string().optional(),
  attempts: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  error: z.string().optional(),
  association: commandAssociationSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
});

export type CommandState = z.infer<typeof commandStateSchema>;

export const commandEventTypeSchema = z.enum([
  'command.snapshot',
  'command.started',
  'command.progress',
  'command.completed',
  'command.failed',
]);

export const commandEventSchema = z.object({
  type: commandEventTypeSchema,
  occurredAt: z.iso.datetime(),
  command: commandStateSchema,
});

export type CommandEvent = z.infer<typeof commandEventSchema>;
